import {ExpressServer} from './server/express-server';
import { Application } from "express";
import {MultiPartService} from "./service/multi-part-service";
let env  = require("./.env.json");
let app: Application;
app = new ExpressServer(env.port,new MultiPartService()).app;
export { app };
