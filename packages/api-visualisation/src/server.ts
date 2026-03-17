<<<<<<< HEAD
import * as express from "express";
import routes from "./routes";
import * as cors from "cors";
import * as morgan from "morgan";

const app = express();

app.use(cors());
app.use(morgan("dev"));
=======
import * as express from "express"
import routes from "./routes";

const app = express();

>>>>>>> 7b71a8b46b21a16f78714aca7f76516f564b4b1c
app.use(express.json());

app.use("/", routes);

app.use(
  (req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.status(404).send();
  },
);

app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    res.status(err.status || 500).send();
  },
);

app.listen(3000, () => {
  console.log(`Server running on http://localhost:3000`);
<<<<<<< HEAD
});
=======
});
>>>>>>> 7b71a8b46b21a16f78714aca7f76516f564b4b1c
