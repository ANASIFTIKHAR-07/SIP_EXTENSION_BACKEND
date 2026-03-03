import "dotenv/config"
import connectDB from "./db/index.js";
import {app} from "./app.js"


connectDB()
.then(()=> {
    app.on("error", (error)=> {
        console.log("Server is not running at the PORT, Please check you PORT.", error);
        throw error
    })
    // start server
    app.listen(process.env.PORT || 4000, ()=> {
        console.log(`🚀 Server is running at PORT : ${process.env.PORT}`);
    })
})
.catch((error)=> {
    console.log("❌ MongoDB connnetion Failed", error)
})