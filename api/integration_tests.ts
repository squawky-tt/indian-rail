import assert from 'assert';

const BASE_URL = 'http://localhost:8787';

async function runTests() {
  console.log('🚂 Starting Indian Railways NTES Integration Tests...\n');

  try {
    // 1. Test OpenAPI JSON Schema Endpoint
    console.log('1. Testing OpenAPI Schema (/openapi.json)');
    const schemaRes = await fetch(`${BASE_URL}/openapi.json`);
    assert.strictEqual(schemaRes.status, 200, 'Schema should return 200');
    const schema = await schemaRes.json();
    assert.strictEqual(schema.info.title, 'Indian Railways NTES API (MCP Compatible)');
    console.log('   ✅ OpenAPI Schema is valid and accessible.\n');

    // 2. Test Train Lookup (12951 - Mumbai Rajdhani)
    console.log('2. Testing Train Lookup Endpoint (/api/trains/12951)');
    const trainRes = await fetch(`${BASE_URL}/api/trains/12951`);
    assert.strictEqual(trainRes.status, 200, 'Train lookup should return 200');
    const trainData = await trainRes.json();
    assert(trainData.train, 'Train object should exist');
    assert.strictEqual(trainData.train.train_number, '12951');
    assert(trainData.train.train_name.includes('Rajdhani'), 'Name should contain Rajdhani');
    console.log(`   ✅ Successfully found train: ${trainData.train.train_name}\n`);

    // 3. Test Train Route Schedule (12951)
    console.log('3. Testing Train Route Schedule (/api/trains/12951/route)');
    const routeRes = await fetch(`${BASE_URL}/api/trains/12951/route`);
    assert.strictEqual(routeRes.status, 200, 'Route lookup should return 200');
    const routeData = await routeRes.json();
    assert(Array.isArray(routeData.route), 'Route should be an array');
    assert(routeData.route.length > 5, 'Rajdhani should have multiple stops');
    
    // Check stop sequences are ordered
    let prevSequence = 0;
    for (const stop of routeData.route) {
      assert(stop.stop_sequence > prevSequence, 'Stop sequences must be in strictly increasing order');
      prevSequence = stop.stop_sequence;
    }
    console.log(`   ✅ Successfully validated route with ${routeData.route.length} stops in correct sequence.\n`);
    console.log(`   Sample stops for 12951:`);
    console.log(`     - Origin: ${routeData.route[0].station_name} (Departs: ${routeData.route[0].departure_time})`);
    console.log(`     - Destination: ${routeData.route[routeData.route.length - 1].station_name} (Arrives: ${routeData.route[routeData.route.length - 1].arrival_time})\n`);

    // 4. Test Live Station Departures (NDLS - New Delhi)
    console.log('4. Testing Live Station Departures (/api/stations/NDLS/live)');
    const stationRes = await fetch(`${BASE_URL}/api/stations/NDLS/live`);
    assert.strictEqual(stationRes.status, 200, 'Station lookup should return 200');
    const stationData = await stationRes.json();
    assert.strictEqual(stationData.station, 'NDLS');
    assert(Array.isArray(stationData.trains), 'Trains should be an array');
    assert(stationData.trains.length > 0, 'New Delhi should have many trains');
    
    // Ensure times are formatted properly
    const sampleTrain = stationData.trains[0];
    if (sampleTrain.arrival_time) {
      assert(/\d{2}:\d{2}/.test(sampleTrain.arrival_time), 'Time must be in HH:MM format');
    }
    console.log(`   ✅ Successfully fetched ${stationData.trains.length} trains passing through NDLS.\n`);

    console.log('🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY!');

  } catch (err: any) {
    console.error(`\n❌ TEST FAILED: ${err.message}`);
    process.exit(1);
  }
}

runTests();
