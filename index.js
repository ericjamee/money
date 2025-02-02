let express = require("express");
let app = express();
let path = require("path");
const session = require("express-session");
const bcrypt = require("bcrypt");

// Database connection
const knex = require("knex")({
  client: "pg",
  connection: {
    host: process.env.RDS_HOSTNAME || "localhost",
    user: process.env.RDS_USERNAME || "postgres",
    password: process.env.RDS_PASSWORD || "6ofseven",
    database: process.env.RDS_DB_NAME || "ebdb",
    port: process.env.RDS_PORT || 5432,
    ssl: process.env.DB_SSL ? { rejectUnauthorized: false } : false,
  },
  pool: {
    min: 2,
    max: 10,
  },
  acquireConnectionTimeout: 10000,
});

module.exports = knex;

const PORT = process.env.PORT || 5000;


// Middleware
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "fallback-secret-key",
    resave: false,
    saveUninitialized: true,
  })
);
const methodOverride = require("method-override");
app.use(methodOverride("_method"));

// Log session for debugging
app.use((req, res, next) => {
  console.log("Session userId:", req.session.userId);
  next();
});

// Routes
app.get("/", (req, res) => res.render("login"));

app.get("/create-account", (req, res) => res.render("create-account"));

app.get("/financial-advice", (req, res) => res.render("financial-advice"));

// Fetch categories dynamically for the transaction page
app.get("/transaction", async (req, res) => {
  try {
    const categories = await knex("categories").select("*").orderBy("category_name", "asc");
    res.render("transaction", { categories });
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).send("Internal Server Error");
  }
});

app.post("/transaction", (req, res) => {
  const { amount, category, date, comments } = req.body; // Include comments
  const userId = req.session.userId;

  if (!userId) {
    return res.redirect("/login");
  }

  // Validation
  if (!amount || isNaN(amount) || amount <= 0) {
    return res.status(400).send("Invalid amount");
  }
  if (!category) {
    return res.status(400).send("Invalid category");
  }
  if (!date || isNaN(Date.parse(date))) {
    return res.status(400).send("Invalid date");
  }

  knex("transactions")
    .insert({
      user_id: userId,
      category_id: category,
      amount: parseFloat(amount),
      date: date || new Date().toISOString(),
      comments: comments || null, // Add comments
    })
    .then(() => res.redirect("/transaction"))
    .catch((error) => {
      console.error("Error adding transaction:", error);
      res.status(500).send("Internal Server Error");
    });
});


// Login route
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.render("login", { errorMessage: "Email and password are required." });
  }

  try {
    const user = await knex("users").where({ email }).first();

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.render("login", { errorMessage: "Invalid email or password." });
    }

    req.session.userId = user.user_id;
    res.redirect("/transaction");
  } catch (error) {
    console.error("Error during login:", error);
    res.status(500).render("login", { errorMessage: "Internal Server Error" });
  }
});

// Create account route
app.post("/create-account", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).send("Email and password are required.");
  }

  try {
    const existingUser = await knex("users").where({ email }).first();

    if (existingUser) {
      return res.status(400).send("Email is already in use.");
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await knex("users").insert({ email, password: hashedPassword });

    res.redirect("/");
  } catch (error) {
    console.error("Error creating account:", error);
    res.status(500).send("Cannot Create Account");
  }
});

// Stats route


//goals
// goals GET route
app.get('/goals', async (req, res) => {
  const userId = req.session.userId;

  if (!userId) {
    return res.redirect('/login');
  }

  const { month, year } = req.query; // Use query params to determine the month and year

  try {
    // Fetch all categories
    const categories = await knex('categories').select('*').orderBy('category_name', 'asc');

    // Fetch existing goals for the user, month, and year
    const existingGoals = await knex('spending_goals')
      .where({ user_id: userId, month: month || new Date().getMonth() + 1, year: year || new Date().getFullYear() })
      .select('category_id', 'goal_amount');

    // Map existing goals to a more accessible format
    const goalsMap = existingGoals.reduce((map, goal) => {
      map[goal.category_id] = goal.goal_amount;
      return map;
    }, {});

    res.render('goals', { categories, goals: goalsMap, month, year });
  } catch (error) {
    console.error('Error fetching goals:', error);
    res.status(500).send('Internal Server Error');
  }
});

// POST route to save goals
app.post('/goals', async (req, res) => {
  const { month, year, goals } = req.body;
  const userId = req.session.userId;

  console.log('Received raw goals object:', goals); // Debug log

  if (!userId) {
    return res.redirect('/login');
  }

  // Ensure goals is treated as an object
  const goalsObject = Array.isArray(goals)
    ? goals.reduce((obj, goalAmount, index) => {
        obj[index + 1] = goalAmount; // Map to category_id starting from 1
        return obj;
      }, {})
    : goals;

  console.log('Transformed goals object:', goalsObject); // Debug log

  try {
    const promises = Object.entries(goalsObject).map(async ([categoryId, goalAmount]) => {
      const parsedCategoryId = parseInt(categoryId, 10);
      const parsedGoalAmount = parseFloat(goalAmount);

      console.log(`Processing categoryId: ${parsedCategoryId}, goalAmount: ${parsedGoalAmount}`); // Debug log

      if (!isNaN(parsedCategoryId) && parsedCategoryId > 0 && !isNaN(parsedGoalAmount)) {
        const categoryExists = await knex('categories')
          .where({ category_id: parsedCategoryId })
          .first();

        if (categoryExists) {
          return knex('spending_goals')
            .insert({
              user_id: userId,
              category_id: parsedCategoryId,
              goal_amount: parsedGoalAmount,
              month: parseInt(month, 10),
              year: parseInt(year, 10),
            })
            .onConflict(['user_id', 'category_id', 'month', 'year'])
            .merge();
        } else {
          console.error(`Invalid category_id: ${parsedCategoryId}`);
        }
      } else {
        console.error(`Invalid input: categoryId=${categoryId}, goalAmount=${goalAmount}`);
      }
    });

    await Promise.all(promises);
    res.redirect('/goals');
  } catch (error) {
    console.error('Error saving goals:', error);
    res.status(500).send('Internal Server Error');
  }
});


//get for stats goals bar graph
app.get("/stats", async (req, res) => {
  const userId = req.session.userId;

  if (!userId) {
    return res.redirect("/login");
  }

  const { month, year, api } = req.query;
  const selectedMonth = parseInt(month || new Date().getMonth() + 1);
  const selectedYear = parseInt(year || new Date().getFullYear());

  try {
    // Fetch all categories dynamically
    const categories = await knex("categories")
      .select("category_name")
      .orderBy("category_name", "asc");

    // Fetch transactions data
    const transactions = await knex("transactions")
      .join("categories", "transactions.category_id", "categories.category_id")
      .select("categories.category_name", knex.raw("SUM(transactions.amount) as total"))
      .whereRaw("EXTRACT(MONTH FROM transactions.date) = ?", [selectedMonth])
      .andWhereRaw("EXTRACT(YEAR FROM transactions.date) = ?", [selectedYear])
      .andWhere("transactions.user_id", userId)
      .groupBy("categories.category_name");

    // Fetch goals data
    const goals = await knex("spending_goals")
      .join("categories", "spending_goals.category_id", "categories.category_id")
      .select("categories.category_name", "spending_goals.goal_amount")
      .where("spending_goals.user_id", userId)
      .andWhere("spending_goals.month", selectedMonth)
      .andWhere("spending_goals.year", selectedYear);

    if (api === "true") {
      return res.json({ spendingData: transactions, goalsData: goals, categories });
    }

    res.render("stats", {
      transactions,
      goals,
      categories, // Send categories to the frontend
      currentMonth: selectedMonth,
      currentYear: selectedYear,
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).send("Internal Server Error");
  }
});

//crud transaction page
app.get("/crudtrans", async (req, res) => {
  const userId = req.session.userId;

  if (!userId) {
      return res.redirect("/");
  }

  const { month, year, category, api } = req.query; // Check if API request

  try {
      let query = knex("transactions")
          .join("categories", "transactions.category_id", "categories.category_id")
          .select(
              "transactions.transaction_id",
              "categories.category_name",
              "transactions.amount",
              "transactions.date",
              "transactions.comments"
          )
          .where("transactions.user_id", userId)
          .orderBy("transactions.date", "desc");

      // Debugging logs to verify filters
      console.log("Filters Received: ", { month, year, category });

      // Apply filters only if values are provided
      if (month && !isNaN(month)) {
          query = query.whereRaw("EXTRACT(MONTH FROM transactions.date) = ?", [month]);
      }

      if (year && !isNaN(year)) {
          query = query.whereRaw("EXTRACT(YEAR FROM transactions.date) = ?", [year]);
      }

      if (category && !isNaN(category)) {
          query = query.where("transactions.category_id", category);
      }

      const transactions = await query;

      // Return JSON if it's an API request
      if (api === "true") {
          return res.json({ transactions });
      }

      // Otherwise, render the EJS page normally
      res.render("crudtrans", { transactions });
  } catch (error) {
      console.error("Error fetching transactions:", error);
      res.status(500).send("Internal Server Error");
  }
});


// Route to get all categories dynamically
app.get("/categories", async (req, res) => {
  try {
      const categories = await knex("categories")
          .select("category_id", "category_name")
          .orderBy("category_name", "asc");
      res.json(categories);
  } catch (error) {
      console.error("Error fetching categories:", error);
      res.status(500).send("Internal Server Error");
  }
});



// Delete a transaction
app.delete("/delete-transaction/:id", async (req, res) => {
  const { id } = req.params;
  const userId = req.session.userId;

  if (!userId) {
    return res.status(403).send("Unauthorized");
  }

  try {
    const deletedCount = await knex("transactions")
      .where({ transaction_id: id, user_id: userId })
      .delete();

    if (deletedCount) {
      res.status(200).send("Transaction deleted successfully");
    } else {
      res.status(404).send("Transaction not found");
    }
  } catch (error) {
    console.error("Error deleting transaction:", error);
    res.status(500).send("Internal Server Error");
  }
});


// CRUD Categories Page
app.get("/crudCategories", async (req, res) => {
  const userId = req.session.userId;

  if (!userId) {
    return res.redirect("/");
  }

  try {
    const categories = await knex("categories")
      .where({ user_id: userId }) // Ensure categories belong to the logged-in user
      .select("*")
      .orderBy("category_name", "asc");

    res.render("crudCategories", { categories });
  } catch (error) {
    console.error("Error fetching categories:", error.message);
    res.status(500).send("Internal Server Error");
  }
});


// Add a New Category
app.post("/categories", async (req, res) => {
  const { category_name } = req.body;
  const userId = req.session.userId;

  if (!userId) {
    return res.redirect("/login");
  }

  try {
    const existingCategory = await knex("categories")
      .where({ category_name, user_id: userId }) // Ensure uniqueness per user
      .first();

    if (existingCategory) {
      return res.status(400).send("Category already exists.");
    }

    await knex("categories").insert({ category_name, user_id: userId });
    res.redirect("/crudCategories");
  } catch (error) {
    console.error("Error adding category:", error.message);
    res.status(500).send("Internal Server Error");
  }
});




// Update a Category
app.put("/categories/:id", async (req, res) => {
  const { id } = req.params;
  const { category_name } = req.body;
  const userId = req.session.userId;

  if (!userId) {
    return res.redirect("/login");
  }

  if (!category_name.trim()) {
    return res.status(400).send("Category name cannot be empty");
  }

  try {
    const category = await knex("categories")
      .where({ category_id: id, user_id: userId }) // Ensure only the user's categories are updated
      .first();

    if (!category) {
      return res.status(404).send("Category not found.");
    }

    await knex("categories").where({ category_id: id, user_id: userId }).update({ category_name });
    res.redirect("/crudCategories");
  } catch (error) {
    console.error("Error updating category:", error.message);
    res.status(500).send("Internal Server Error");
  }
});


// Delete a Category
app.delete("/categories/:id", async (req, res) => {
  const { id } = req.params;
  const userId = req.session.userId;

  if (!userId) {
    return res.redirect("/login");
  }

  try {
    const deletedCount = await knex("categories")
      .where({ category_id: id, user_id: userId }) // Ensure only the user's categories are deleted
      .delete();

    if (!deletedCount) {
      return res.status(404).send("Category not found or unauthorized.");
    }

    res.redirect("/crudCategories");
  } catch (error) {
    console.error("Error deleting category:", error.message);
    res.status(500).send("Internal Server Error");
  }
});



// Start server
app.listen(PORT, () => console.log(`Server is running on http://localhost:${PORT}`));
