require('dotenv').config();
const { setupDatabase, Setting } = require('./database');

async function run() {
    await setupDatabase();
    await Setting.updateOne({ key: 'markup' }, { value: '1.15' }, { upsert: true });
    console.log("Markup successfully updated to 1.15 in MongoDB!");
    process.exit(0);
}

run();
