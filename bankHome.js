
//imports and setup stuff
const express = require('express');
const app = express();  //creates an express instance
const path = require('path'); 
const { MongoClient, ServerApiVersion } = require('mongodb'); //imports mongoDB client
require('dotenv').config(); // load variables from .env

// mongoDB connection string !!!change this to your mongo url!!!!
const uri = `mongodb+srv://${process.env.MONGO_DB_USERNAME}:${process.env.MONGO_DB_PASSWORD}@cluster0.mlby5.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
// connect to MongoDB
let db;
let mongoClient;

async function connectToDB() {
    try {
        mongoClient = new MongoClient(uri);
        await mongoClient.connect();
        db = mongoClient.db(process.env.MONGO_DB_NAME);
    } catch (err) {
        console.error("Failed to connect to MongoDB", err);
        process.exit(1);
    }
}

// parses urls/json
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// sets up the templates and specifies ejs
app.set('views', path.join(__dirname, 'templates'));
app.set('view engine', 'ejs');













/* ROUTES START*/



// renders the WELCOME page with login/signup functionality
app.get('/', (req, res) => {
    res.render('index', { isSignup: false, error: null }); //uses a variable to toggle between login/signup
});



// renders the signup form that shows up when the user clicks "Signup here"
app.get('/signup', (req, res) => {
    res.render('index', { isSignup: true, error: null }); // toggle to display signup form
});



// handles the login form submission (checks if user credentials are legit)
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.render('index', { isSignup: false, error: "Email and Password are required!" });
    }

    try {
        const user = await db.collection('users').findOne({ email, password });

        if (!user) {
            return res.render('index', { isSignup: false, error: "Invalid email or password!" });
        }

        res.redirect(`/profile?email=${encodeURIComponent(email)}`);
    } catch (err) {
        console.error("Error during login:", err);
        res.render('index', { isSignup: false, error: "An unexpected error occurred during login." });
    }
});



// handles the signup form submission (checks if signup credentials arent already used)
app.post('/signup', async (req, res) => {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
        return res.render('index', { isSignup: true, error: "Name, Email, and Password are required!" });
    }

    try {
        const existingUser = await db.collection('users').findOne({ email });

        if (existingUser) {
            return res.render('index', { isSignup: true, error: "Email is already registered!" });
        }

        await db.collection('users').insertOne({ name, email, password, balance: 0 }); // the initial balance set to 0 (as user will have 0 dollars)
        res.redirect('/');
    } catch (err) {
        console.error("Error during signup:", err);
        res.render('index', { isSignup: true, error: "An unexpected error occurred during signup." });
    }
});



//finds and renders the user associated with the login information
app.get('/profile', async (req, res) => {
    const { email } = req.query;
    try {
        const user = await db.collection('users').findOne({ email });

        if (!user) {
            return res.status(404).send("User not found.");
        }

        res.render('profile', { user, error: null, error2: null });  // pass in error as null since we need to have an error value in case withdrawal fails
    } catch (err) {
        console.error("Error fetching profile:", err);
        res.status(500).send("Error fetching profile.");
    }
});



//deletes the associated user from the mongoDB database
app.post('/delete', async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).send("Email is required to delete user!");
    }

    try {
        const result = await db.collection('users').deleteOne({ email });
        if (result.deletedCount === 0) {
            return res.status(404).send(`
                <p>User not found. Try to log in to another account.</p>
                <a href="/">Here</a>`);
        }
        res.render('delete', { message: "User deleted successfully!" });
    } catch (err) {
        console.error("Error deleting user:", err);
        res.status(500).send("Error deleting user.");
    }
});



// handles the search page
// uses regex to search for users by name or email and forms an array of users that match
// then renders search.ejs with the related users
app.get('/search', async (req, res) => {
    const {query} = req.query;
    try {
        const users = await db.collection('users').find({
            $or: [
                { name: { $regex: query, $options: 'i' } },
                { email: { $regex: query, $options: 'i' } }
            ]
        }).toArray();

        res.render('search', { users });
    } catch (err) {
        console.error("Error searching users:", err);
        res.status(500).send("Error searching users.");
    }
});



// handles the list users page
// fetches all the users from the database and renders allUsers.ejs which displays all the suers in a list
app.get('/list-all-users', async (req, res) => {
    try {
        const users = await db.collection('users').find().toArray();
        res.render('allUsers', { users });
    } catch (err) {
        console.error("Error fetching all users:", err);
        res.status(500).send("Error fetching users.");
    }
});



// deposit money backend
// makes sure the amount deposited is not negative
// adds money to the user balance
app.post('/deposit', async (req, res) => {
    const { email, depositAmount } = req.body;
    const amount = parseFloat(depositAmount);

    if (isNaN(amount) || amount <= 0) {
        return res.status(400).send("Deposit amount must be a positive number.");
    }

    try {
        const user = await db.collection('users').findOne({ email });
        if (!user) {
            return res.status(404).send("User not found.");
        }

        const newBalance = user.balance + amount;
        await db.collection('users').updateOne({ email }, { $set: { balance: newBalance } });

        res.redirect(`/profile?email=${encodeURIComponent(email)}`);
    } catch (err) {
        console.error("Error during deposit:", err);
        res.status(500).send("Error during deposit.");
    }
});

// withdraw money backend
// makes sure the amount withdrawn does not make the balance negative
// subtracts money from the user balance
app.post('/withdraw', async (req, res) => {
    const { email, withdrawAmount } = req.body;
    const amount = parseFloat(withdrawAmount);

    if (isNaN(amount) || amount <= 0) {
        return res.status(400).send("Withdraw amount must be a positive number.");
    }

    try {
        const user = await db.collection('users').findOne({ email });
        if (!user) {
            return res.status(404).send("User not found.");
        }

        // check if user has enough money to withdraw
        if (user.balance < amount) {
            // if insufficient funds then pass an error to profile.ejs to be displayed
            return res.render('profile', { 
                user, 
                error: "Insufficient funds.",
                error2: null
            });
        }

        // otherwise if enough money then subtract from balance
        const newBalance = user.balance - amount;
        await db.collection('users').updateOne({ email }, { $set: { balance: newBalance } });

        // redirect back to page to display the new balance
        res.redirect(`/profile?email=${encodeURIComponent(email)}`);
    } catch (err) {
        console.error("Error during withdraw:", err);
        res.status(500).send("Error during withdraw.");
    }
});







// transfer money from a sender to a receiver
// subtract from the sender balance and add to the receiver balance
app.post('/transfer', async (req, res) => {
    const { senderEmail, recipientEmail, amount } = req.body;
    const transferAmount = parseFloat(amount);

    if (isNaN(transferAmount) || transferAmount <= 0) {
        return res.status(400).send("Transfer amount must be a positive number.");
    }

    try {
        // find the sender and recipient from mongoDB
        const sender = await db.collection('users').findOne({ email: senderEmail });
        const recipient = await db.collection('users').findOne({ email: recipientEmail });

        if (!sender) {
            return res.render('profile', { 
                user: sender, 
                error: null, 
                error2: "Sender not found."
            });
        }
        if (!recipient) {
            return res.render('profile', { 
                user: sender, 
                error: null, 
                error2: "Recipient not found."
            });
        }
        if (sender.balance < transferAmount) {
            return res.render('profile', { 
                user: sender, 
                error: null, 
                error2: "Insufficient funds."
            });
        }

        // update the balance after the transfer
        const newSenderBalance = sender.balance - transferAmount;
        const newRecipientBalance = recipient.balance + transferAmount;

        await db.collection('users').updateOne({ email: senderEmail }, { $set: { balance: newSenderBalance } });
        await db.collection('users').updateOne({ email: recipientEmail }, { $set: { balance: newRecipientBalance } });

        // redirect back to the sender profile in order to display the changes
        res.redirect(`/profile?email=${encodeURIComponent(senderEmail)}`);
    } catch (err) {
        console.error("Error during transfer:", err);
        res.status(500).send("Error during transfer.");
    }
});



/* ROUTES STOP*/
















// start the server after connecting to the database
// use port 3000 by default but port can be specified
const PORT = process.argv[2] || process.env.PORT || 3000;

connectToDB().then(() => {
    const server = app.listen(PORT, () => {
        console.log(`Web server started and running at http://localhost:${PORT}`);
        process.stdout.write("Stop to shut down the server: ");
    });

    // Start listening for commands in the terminal
    process.stdin.on("data", (data) => {
        const command = data.toString().trim();
    
        if (command === "stop") {
            console.log("Shutting down the server");
            server.close(async () => {
                try {
                    if (mongoClient) {
                        await mongoClient.close();
                    }
                } catch (err) {
                    console.error("Error closing MongoDB connection:", err);
                }
                process.exit(0);
            });
        } else {
            console.log(`Invalid command: ${command}`);
        }
    });

}).catch(err => {
    console.error("Failed to start server:", err);
});