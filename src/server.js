
require("dotenv").config();

const app = require("./app");
const { isAuthRequired } = require("./config/security");

const PORT = process.env.PORT || 3000;

if (!isAuthRequired()) {
  console.warn("WARNING: AUTH_REQUIRED=false - authentication and authorization are temporarily bypassed.");
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
