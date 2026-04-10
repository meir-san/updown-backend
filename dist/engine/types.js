"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarketStatus = exports.OrderStatus = exports.OrderType = exports.OrderSide = void 0;
var OrderSide;
(function (OrderSide) {
    OrderSide[OrderSide["BUY"] = 0] = "BUY";
    OrderSide[OrderSide["SELL"] = 1] = "SELL";
})(OrderSide || (exports.OrderSide = OrderSide = {}));
var OrderType;
(function (OrderType) {
    OrderType[OrderType["LIMIT"] = 0] = "LIMIT";
    OrderType[OrderType["MARKET"] = 1] = "MARKET";
})(OrderType || (exports.OrderType = OrderType = {}));
var OrderStatus;
(function (OrderStatus) {
    OrderStatus["OPEN"] = "OPEN";
    OrderStatus["PARTIALLY_FILLED"] = "PARTIALLY_FILLED";
    OrderStatus["FILLED"] = "FILLED";
    OrderStatus["CANCELLED"] = "CANCELLED";
})(OrderStatus || (exports.OrderStatus = OrderStatus = {}));
var MarketStatus;
(function (MarketStatus) {
    MarketStatus["ACTIVE"] = "ACTIVE";
    MarketStatus["TRADING_ENDED"] = "TRADING_ENDED";
    MarketStatus["RESOLVED"] = "RESOLVED";
    MarketStatus["CLAIMED"] = "CLAIMED";
})(MarketStatus || (exports.MarketStatus = MarketStatus = {}));
//# sourceMappingURL=types.js.map