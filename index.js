import { RevAiApiClient } from 'revai-node-sdk';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers'
import dotenv from 'dotenv';
import { Readable } from 'stream';
import AWS from 'aws-sdk';

AWS.config.update({ region: 'eu-west-1' });
dotenv.config();

const s3 = new AWS.S3();
const speechAPI = new RevAiApiClient(process.env.REV_API_KEY);
const stream = new Readable();
stream._read = () => {};

async function run({
  from,
  to,
  verbose
}) {
  if (from > to) {
    const log = buildLogger(true);
    log('Processed 0 items.');
    return;
  }
  const log = buildLogger(verbose);
  let parsed = 0;

  for (let i = from; i <= to; i++) {
    log(`Start parsing episode #${i}`);
    try {
      const text = await parseAudio(`https://download.softskills.audio/sse-${i}.mp3`, log);
      log(`Finish parsing episode #${i}`);

      stream.push(parseWhatItTakes(text));
      parsed++;
    } catch (e) {
      console.error(e);
      console.log(`Failed to parse episode #${i}`);
    }
  }
  log(`Parsed ${parsed} items.`);
  stream.push(null);

  if (parsed > 0) {
    log('Start creating an S3 bucket');
    const bucket = "what-does-it-take-to-be-a-great-engineer";
    try {
      await createBucketIfNotExists(bucket);
    } catch (e) {
      console.error(e);
      return;
    }
    log('Finish creating the bucket');
    log('Start uploading to S3');
    try {
      await uploadFile(bucket, `${Date.now()}.txt`, stream);
    } catch (e) {
      console.error(e);
      return;
    }
    log('Finish uploading to S3');
  }
}

yargs(hideBin(process.argv))
  .command('run [from] [to]', 'parse specified episodes', (yargs) => {
    return yargs
      .positional('from', {
        describe: 'start',
        default: 0
      })
      .positional('to', {
        describe: 'end',
        default: -1
      })
  }, async (argv) => {
    await run(argv);
  })
  .option('verbose', {
    alias: 'v',
    type: 'boolean',
    description: 'Run with verbose logging'
  })
  .parse()

function buildLogger(verbose) {
  return function(msg) {
    if (verbose) {
      console.log(msg);
    }
  }
}

function parseWhatItTakes(text) {
  const re = /(?<=It takes more than)(.*)(?=This is episode)/s;
  return 'It takes more than' + re.exec(text)[0];
}

async function parseAudio(url, log) {
  const { id } = await speechAPI.submitJob({
    source_config: { url }
  });

  log(`SpeechAI job has started: ${id}`);
  let status = "in_progress";
  while (status === "in_progress") {
    log(`The job is in progress...`);
    await wait(5000);
    const job = await speechAPI.getJobDetails(id);
    status = job.status;
  }
  log(`The job is finished!`);

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
    })
  });
}

async function uploadFile(bucket, name, stream) {
  return new Promise((resolve, reject) => {
    s3.upload({ Bucket: bucket, Body: stream, Key: name }, (err, data) => {
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