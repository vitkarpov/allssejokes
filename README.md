### What does it take to be a great software engineer?

TLDR; Follow @[allssejokes](https://twitter.com/allssejokes) to know.

I've been listening to Soft Skills Engineering podcast for years. Every episode starts with a joke: "It takes more than ... to be a great software engineering", and I was wondering if I could collect all Dave and Jamison jokes 🤔

It takes more than wondering to be a great software engineer, doesn't it?

🚀 Here's the podcast parser that:

- grabs specified episode (or a range) from SSE archive
- parses first 30 seconds of the audio file (with Rev.AI)
- uploads the joke to S3 (in a separate file)

Now I have the ultimate wisdom saved in S3. Thank to Dave Smith & Jamison Dance!

```
$ node index.js --help
```

Feel free to play with it if yoo want but you'll need your own API keys (check out .env) to make it work.