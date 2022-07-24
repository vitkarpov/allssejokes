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
  const bucket = "sse-mp3";

  log("Start fetching MP3");
  await downloadFile(
    `https://download.softskills.audio/sse-${episode}.mp3`,
    `full_${fileName}`
  );
  // TODO: promise above resolves before the writable stream closes
  await wait(1000);
  log("Finish fetching MP3");

  MP3Cutter.cut({
    src: `full_${fileName}`,
    target: fileName,
    start: 0,
    end: 30,
  });

  log("Start uploading to S3");
  await uploadFile(bucket, fileName, fs.createReadStream(fileName), true);
  log("Finish uploading to S3");
}

async function transcribe({ episode, verbose }) {
  const log = buildLogger(verbose);
  const bucket = "sse-txt";

  log(`---Episode #${episode}---`);
  log("Start parsing audio");
  const text = await parseAudio(
    `https://sse-mp3.s3.eu-west-1.amazonaws.com/sse-${episode}.mp3`,
    log
  );
  log("Finish parsing audio");

  log("Start uploading to S3");
  await uploadFile(bucket, `episode-${episode}.txt`, parseWhatItTakes(text));
  log("Finish uploading to S3");
}

yargs(hideBin(process.argv))
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
        console.log(`Failed transcribe: ${e}`);
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
        console.log(`Failed transcribe: ${e}`);
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
  const re = /(?<=It takes more than)(.*)(?=This is episode)/s;
  return 'It takes more than' + re.exec(text)[0];
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

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function downloadFile(url, targetFile) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        response.pipe(fs.createWriteStream(targetFile));
      })
      .on("error", reject)
      .on("finish", resolve);
  });
}
