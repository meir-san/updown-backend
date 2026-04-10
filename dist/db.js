"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectDb = connectDb;
const mongoose_1 = __importDefault(require("mongoose"));
const config_1 = require("./config");
async function connectDb() {
    try {
        await mongoose_1.default.connect(config_1.config.mongoUri);
        console.log(`[DB] Connected to MongoDB at ${config_1.config.mongoUri}`);
    }
    catch (err) {
        console.error('[DB] Failed to connect:', err);
        process.exit(1);
    }
    mongoose_1.default.connection.on('error', (err) => {
        console.error('[DB] Connection error:', err);
    });
    mongoose_1.default.connection.on('disconnected', () => {
        console.warn('[DB] Disconnected from MongoDB');
    });
}
//# sourceMappingURL=db.js.map