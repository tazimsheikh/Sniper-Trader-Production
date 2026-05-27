const MetaApiPkg = require('metaapi.cloud-sdk/esm-node');
const MetaApi = MetaApiPkg.default || MetaApiPkg;

async function test() {
  const api = new MetaApi('dummy-token');
  try {
    const accounts = await api.metatraderAccountApi.getAccountsWithClassicPagination();
    console.log(accounts);
  } catch (err) {
    console.log('Error:', err.message);
  }
}
test();
