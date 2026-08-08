import { fetchLiveEconomicCalendar } from "./newsFetcher.js";

async function test() {
    console.log("Fetching live economic calendar...");
    const events = await fetchLiveEconomicCalendar();
    console.log(`Fetched ${events.length} events.`);
    if (events.length > 0) {
        console.log(events[0]);
    }
}

test().catch(console.error);
