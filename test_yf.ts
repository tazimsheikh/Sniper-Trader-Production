import yahooFinance2 from 'yahoo-finance2';
const YFClass = typeof yahooFinance2 === 'function' ? yahooFinance2 : (yahooFinance2 as any).default;
const yahooFinance = new YFClass();
async function testHistorical() {
    try {
        const result = await yahooFinance.chart('NQ=F', {
            period1: '2023-01-01',
            period2: '2023-01-08',
            interval: '1m'
        });
        console.log(`Successfully fetched ${result.quotes.length} 1m quotes from early 2023`);
    } catch (e: any) {
        console.error('Error fetching 1m data from 2023:', e.message);
    }
    
    try {
        const today = new Date();
        const eightDaysAgo = new Date(today);
        eightDaysAgo.setDate(eightDaysAgo.getDate() - 7);
        
        const result = await yahooFinance.chart('NQ=F', {
            period1: eightDaysAgo.toISOString().split('T')[0],
            interval: '1m'
        });
        console.log(`Successfully fetched ${result.quotes.length} 1m quotes from last 8 days`);
        if (result.quotes.length > 0) {
            console.log('Oldest quote:', new Date(result.quotes[0].date).toISOString());
        }
    } catch (e: any) {
        console.error('Error fetching recent 1m data:', e.message);
    }
}

testHistorical();
