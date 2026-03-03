class ApiError extends Error {
    constructor (
        statusCode,
        message = "Something went wrong",
        errors = [],
        stack = ""
    ) {
        super(message)
        this.data = null
        this.statusCode = statusCode
        this.message = message
        this.success = false
        this.errors = errors
        this.name = this.constructor.name

        if (stack) {
            this.stack = stack
        }
        else{
            Error.captureStackTrace(this, this.constructor)
        }
    }
}


export { ApiError }