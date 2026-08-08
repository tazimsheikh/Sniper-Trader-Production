import { fetchLiveEconomicCalendar } from '../../news/newsFetcher.js';
import { getCachedEvents } from '../../news/newsStore.js';

async function main() {
  console.log('Fetching live news...');
  const events = await fetchLiveEconomicCalendar();
  console.log('Fetched events:', events);
}

main().catch(console.error);