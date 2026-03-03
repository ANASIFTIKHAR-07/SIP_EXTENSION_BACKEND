import mongoose from "mongoose"
import { DB_NAME } from '../constants.js';


const connectDB = async () => {
    try {
        const connectionInstance = await mongoose.connect(`${process.env.MONGODB_URI}/${DB_NAME}`)
        console.log(`\n MongoDB connected !! DB Host : ${connectionInstance.connection.host}`)
        console.log(`Database Name: ${connectionInstance.connection.name}`)
    } catch (error) {
        console.error("Mongo Db connection Failed!!", error)
        process.exit(1)
    }
}


export default connectDB;