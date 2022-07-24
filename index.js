import { RevAiApiClient } from "revai-node-sdk";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import dotenv from "dotenv";
import AWS from "aws-sdk";

AWS.config.update({ region: "eu-west-1" });
dotenv.config();

const s3 = new AWS.S3();
const speechAPI = new RevAiApiClient(process.env.REV_API_KEY);

async function transcribe({ episode, verbose }) {
  const log = buildLogger(verbose);
  const bucket = "what-does-it-take-to-be-a-great-engineer";

  log("Start creating an S3 bucket");
  await createBucketIfNotExists(bucket);
  log("Finish creating the bucket");

  log(`---Episode #${episode}---`);
  log("Start parsing audio");
  const text = await parseAudio(
    `https://download.softskills.audio/sse-${episode}.mp3`,
    log
  );
  log("Finish parsing audio");

  log("Start uploading to S3");
  await uploadFile(bucket, `episode-${episode}.txt`, text);
  log("Finish uploading to S3");
}

yargs(hideBin(process.argv))
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

async function uploadFile(bucket, name, body) {
  return new Promise((resolve, reject) => {
    s3.upload({ Bucket: bucket, Body: body, Key: name }, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data.Location);
      }
    });
  });
}

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
