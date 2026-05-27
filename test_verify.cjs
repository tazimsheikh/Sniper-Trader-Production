const { verifyMetaApiToken } = require('./dist/server.cjs');

async function run() {
  console.log("Testing invalid token...");
  const isValid1 = await verifyMetaApiToken("invalid_token_12345678901234567890");
  console.log("isValid (invalid):", isValid1);

  console.log("Testing empty token...");
  const isValid2 = await verifyMetaApiToken("");
  console.log("isValid (empty):", isValid2);
}
run();
