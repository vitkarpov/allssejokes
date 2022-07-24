import { RevAiApiClient } from "revai-node-sdk";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import dotenv from "dotenv";
import AWS from "aws-sdk";
import MP3Cutter from "mp3-cutter";
import https from "https";
import fs from "fs";

AWS.config.update({ region: "eu-west-1" });
dotenv.config();

const s3 = new AWS.S3();
const speechAPI = new RevAiApiClient(process.env.REV_API_KEY);

async function cut({ episode, verbose }) {
  const log = buildLogger(verbose);
  const fileName = `sse-${episode}.mp3`;
  const tmpFileName = `tmp_${fileName}`;
  const bucket = "sse-mp3";

  log(`---Cut episode #${episode}---`);

  const alreadyExists = await checkIfObjectExists(bucket, fileName);
  if (alreadyExists) {
    log('Already exists');
    return;
  }

  if (!fs.existsSync(tmpFileName)) {
    log("Start fetching MP3");
    await downloadFile(`https://download.softskills.audio/sse-${episode}.mp3`, tmpFileName);
    log("Finish fetching MP3");
  }

  MP3Cutter.cut({
    src: tmpFileName,
    target: fileName,
    start: 0,
    end: 30,
  });

  log("Start uploading to S3");
  await uploadFile(bucket, fileName, fs.createReadStream(fileName), true);
  log("Finish uploading to S3");

  await Promise.all([removeFile(tmpFileName), removeFile(fileName)]);
}

async function transcribe({ episode, verbose }) {
  const log = buildLogger(verbose);
  const fileName = `episode-${episode}.txt`;
  const bucket = "sse-txt";

  log(`---Transcribe episode #${episode}---`);

  const alreadyExists = await checkIfObjectExists(bucket, fileName);
  if (alreadyExists) {
    log('Already exists');
    return;
  }
  log("Start parsing audio");
  const text = await parseAudio(
    `https://sse-mp3.s3.eu-west-1.amazonaws.com/sse-${episode}.mp3`,
    log
  );
  log("Finish parsing audio");

  log("Start uploading to S3");
  await uploadFile(bucket, fileName, parseWhatItTakes(text));
  log("Finish uploading to S3");
}

yargs(hideBin(process.argv))
  .command(
    "all [from] [to]",
    "run for a range of episodes",
    (yargs) => {
      return yargs
        .positional("from", {
          describe: "start episode number",
          default: 103,
        })
        .positional("to", {
          describe: "end episode number",
          default: 313,
        });
    },
    async (argv) => {
      let processed = 0;
      const failedEpisodes = [];

      await Promise.allSettled(
        new Array(argv.to - argv.from).fill(0).map(async (_, i) => {
          const episode = argv.from + i;
          const verbose = argv.verbose;
          try {
            await cut({ episode, verbose });
            await transcribe({ episode, verbose });
            processed++;
          } catch (e) {
            failedEpisodes.push(e);
          }
        })
      );

      console.log(`Processed ${processed} episodes`);
      console.log(`--Failed--`);
      console.log(failedEpisodes.join('\n'));
    }
  )
  .command(
    "run [episode]",
    "cut & transcribe",
    (yargs) => {
      return yargs.positional("episode", {
        describe: "episode number",
        default: 0,
      });
    },
    async (argv) => {
      try {
        await cut(argv);
        await transcribe(argv);
      } catch (e) {
        console.log(`Failed: ${e}`);
      }
    }
  )
  .command(
    "transcribe [episode]",
    "parse audio & upload the transcript to S3",
    (yargs) => {
      return yargs.positional("episode", {
        describe: "episode number",
        default: 0,
      });
    },
    async (argv) => {
      try {
        await transcribe(argv);
      } catch (e) {
        console.log(`Failed: ${e}`);
      }
    }
  )
  .command(
    "cut [episode]",
    "cut MP3 to first 30 seconds & upload to S3",
    (yargs) => {
      return yargs.positional("episode", {
        describe: "episode number",
        default: 0,
      });
    },
    async (argv) => {
      try {
        await cut(argv);
      } catch (e) {
        console.log(`Failed cut: ${e}`);
      }
    }
  )
  .option("verbose", {
    alias: "v",
    type: "boolean",
    description: "Run with verbose logging",
  })
  .parse();

function buildLogger(verbose) {
  return function (msg) {
    if (verbose) {
      console.log(msg);
    }
  };
}

function parseWhatItTakes(text) {
  const re = /(?<=akes more than)(.*)(?=to be a great)/s;
  if (!re.exec(text)) {
    throw new Error(`Invalid text: ${text}`);
  }
  return 'It takes more than' + re.exec(text)[0] + 'to be a great software engineer';
};

async function parseAudio(url, log) {
  const { id } = await speechAPI.submitJob({
    source_config: { url },
  });

  log(`SpeechAI job has started: ${id}`);
  let status = "in_progress";
  while (status === "in_progress") {
    log("The job is in progress...");
    await wait(5000);
    const job = await speechAPI.getJobDetails(id);
    status = job.status;
  }
  log("The job is finished!");

  return speechAPI.getTranscriptText(id);
}

async function createBucketIfNotExists(name) {
  return new Promise((resolve, reject) => {
    s3.headBucket({ Bucket: name }, (err, data) => {
      if (err) {
        s3.createBucket({ Bucket: name }, (err, data) => {
          if (err) {
            reject(err);
          } else {
            resolve(data.Location);
          }
        });
      } else {
        resolve(data.Location);
      }
    });
  });
}

async function checkIfObjectExists(bucket, name) {
  return new Promise((resolve, reject) => {
    s3.headObject({ Bucket: bucket, Key: name }, (err) => {
      if (err && err.name === 'NotFound') {
        resolve(false);
      } else if (err) {
        reject(err);
      } else {
        resolve(true);
      }
    });
  });
}

async function uploadFile(bucket, name, body, isPublic = false) {
  await createBucketIfNotExists(bucket);
  return new Promise((resolve, reject) => {
    s3.upload(
      {
        Bucket: bucket,
        Body: body,
        Key: name,
        ACL: isPublic ? "public-read" : "private",
      },
      (err, data) => {
        if (err) {
          reject(err);
        } else {
          resolve(data.Location);
        }
      }
    );
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function removeFile(file) {
  return new Promise((resolve, reject) => {
    fs.unlink(file, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    })
  });
}

function downloadFile(url, dst) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        const s = fs.createWriteStream(dst);
        response.pipe(s);
        response.on("end", resolve);
      })
      .on("error", reject);
  });
}
