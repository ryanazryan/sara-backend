import "dotenv/config";
import app from "./app.js";
import { assertProductionSecurityConfig } from "./config/http-security.js";

assertProductionSecurityConfig(process.env);
const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
  console.log(`SARA Backend running on http://localhost:${PORT}`);
});
