import dotenv from 'dotenv';
dotenv.config();

import Database from 'better-sqlite3';
import path from 'path';
import { decrypt, isEncrypted } from './server/crypto.js';

// @ts-ignore
import MetaApiPkg from 'metaapi.cloud-sdk/esm-node';
// @ts-ignore
const MetaApi = MetaApiPkg.default ?? MetaApiPkg;

const dbPath = path.join(process.cwd(), 'data', 'database.sqlite');
const db = new Database(dbPath);

async function runTest() {
  console.log('Retrieving credentials...');
  const user = db.prepare('SELECT metaapi_token, metaapi_account_id FROM users WHERE id = 1').get() as any;
  if (!user || !user.metaapi_token || !user.metaapi_account_id) {
    console.error('No MetaAPI credentials found in database.');
    return;
  }

  const token = isEncrypted(user.metaapi_token) ? decrypt(user.metaapi_token) : user.metaapi_token;
  const accountId = user.metaapi_account_id;

  console.log(`Connecting to MetaAPI using account ID: ${accountId}...`);
  const api = new MetaApi(token);
  
  const startTime = Date.now();
  const account = await api.metatraderAccountApi.getAccount(accountId);
  console.log(`Account connection verified in ${Date.now() - startTime}ms.`);
  console.log(`Account state: ${account.state}`);
  
  if (account.state !== 'DEPLOYED') {
    console.log('Deploying account...');
    await account.deploy();
  }
  
  console.log('Waiting for connection...');
  await account.waitConnected();
  
  const connectionStartTime = Date.now();
  const conn = account.getRPCConnection();
  await conn.connect();
  console.log(`Connected to RPC Connection in ${Date.now() - connectionStartTime}ms.`);

  console.log('Synchronizing...');
  const syncStartTime = Date.now();
  await Promise.race([
    conn.waitSynchronized(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Sync timeout')), 30000)),
  ]);
  console.log(`Synchronized in ${Date.now() - syncStartTime}ms.`);

  const accountInfo = await conn.getAccountInformation();
  console.log('\n================ ACCOUNT DETAILS ================');
  console.log(`Broker:   ${accountInfo.broker}`);
  console.log(`Currency: ${accountInfo.currency}`);
  console.log(`Balance:  $${accountInfo.balance}`);
  console.log(`Leverage: 1:${accountInfo.leverage}`);
  console.log('=================================================\n');

  const symbol = 'AUDUSD';
  console.log(`Placing a test market order: BUY 0.01 ${symbol}...`);
  const orderStartTime = Date.now();
  
  // Place BUY order
  let orderResult: any;
  try {
    orderResult = await conn.createMarketBuyOrder(symbol, 0.01, undefined, undefined, {
      comment: '[API_TEST]',
    });
  } catch (e: any) {
    console.error('Order placement failed:', e.message);
    return;
  }
  const orderLatency = Date.now() - orderStartTime;
  console.log(`Order PLACED successfully!`);
  console.log(`Latency: ${orderLatency}ms`);
  console.log(`Order ID: ${orderResult.orderId}`);
  console.log(`Position ID: ${orderResult.positionId || 'N/A'}`);

  console.log('\nWaiting 2 seconds...');
  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log(`\nClosing test order (Position ID: ${orderResult.positionId || orderResult.orderId})...`);
  const closeStartTime = Date.now();
  let closeResult: any;
  try {
    closeResult = await conn.closePosition(orderResult.positionId || orderResult.orderId, {});
  } catch (e: any) {
    console.error('Close position failed:', e.message);
    return;
  }
  const closeLatency = Date.now() - closeStartTime;
  console.log(`Order CLOSED successfully!`);
  console.log(`Latency: ${closeLatency}ms`);

  console.log('\n================ LATENCY METRICS ================');
  console.log(`Connection: ${Date.now() - connectionStartTime}ms`);
  console.log(`Order Open: ${orderLatency}ms`);
  console.log(`Order Close: ${closeLatency}ms`);
  console.log('=================================================\n');
}

runTest().catch(console.error);
