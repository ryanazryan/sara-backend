import pool from "./database.js";

const testDatabaseConnection = async () => {
  try {
    const [rows] = await pool.query("SELECT 1 AS result");

    console.log("MySQL connection successful");
    console.log(rows);
  } catch (error) {
    console.error("MySQL connection failed:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
};

testDatabaseConnection();
