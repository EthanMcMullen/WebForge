import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI?.trim();
if (!uri) {
  console.error("MONGODB_URI is missing from .env.local.");
  process.exitCode = 1;
} else {
  let client;
  try {
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
    await client.connect();
    const name = process.env.MONGODB_DB_NAME?.trim() || "webforge";
    await client.db(name).command({ ping: 1 });
    console.log(`MongoDB Atlas connection successful. Database: ${name}`);
  } catch {
    console.error("MongoDB connection failed. Check the URI, database user, and Atlas Network Access.");
    process.exitCode = 1;
  } finally {
    await client?.close();
  }
}
