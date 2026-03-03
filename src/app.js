import express from "express"
import cors from "cors"
import cookieParser from "cookie-parser"

const app = express()

app.use(cors({
    credentials: true,
    origin: process.env.CORS_ORIGIN,
}))


app.use(cookieParser())
app.use(express.json({limit: "16kb"}))
app.use(express.urlencoded({limit: "16kb", extended: true}))
app.use(express.static("public"))


// Routes for the Controllers

import userRoutes from "./routes/user.routes.js"
import extensionRoutes from "./routes/extension.routes.js"
app.use("/api/v1/users", userRoutes)
app.use("/api/v1/sip", extensionRoutes)



app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: "Route not found"
    });
});


app.use((err, req, res, next) => {
    console.error(err); // optional logging
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({
        statusCode,
        success: false,
        message: err.message || "Internal Server Error",
        data: null
    });
});


export {app}