import MetaApiPkg from 'metaapi.cloud-sdk/esm-node';
const MetaApi = (MetaApiPkg as any).default || MetaApiPkg;

async function run() {
  const api = new MetaApi("invalid_token_12345678901234567890");
  try {
    await api.metatraderAccountApi.getAccountsWithClassicPagination();
    console.log("Success");
  } catch (err: any) {
    console.log("Error status:", err.status);
    console.log("Error name:", err.name);
    console.log("Error message:", err.message);
  }
}
run();
