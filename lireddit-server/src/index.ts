import "reflect-metadata";
import { MikroORM } from "@mikro-orm/core";
import express from "express";
import { ApolloServer } from "apollo-server-express";
import { buildSchema } from "type-graphql";
// const { createClient } = require("redis");
const session = require("express-session");
import cors from "cors";
import Redis from "ioredis";

import mikroOrmConfig from "./mikro-orm.config";
import { PostsResolver } from "./resolvers/post";
import { UserResolver } from "./resolvers/user";
import { COOKIE_NAME, __prod__ } from "./constants";

const main = async () => {
  const orm = await MikroORM.init(mikroOrmConfig);
  await orm.getMigrator().up();

  const app = express();

  let RedisStore = require("connect-redis")(session);
  // let redisClient = createClient({
  //   legacyMode: true,
  //   PORT: 5001
  // });
  const redis = new Redis();

  app.use(cors({
    origin: ["http://localhost:3000", "https://studio.apollographql.com"], credentials: true
  }));

  app.set('trust proxy', 1);

  // await redisClient.connect();

  app.use(
    session({
      name: COOKIE_NAME,
      store: new RedisStore({ client: redis, disableTouch: true, }),
      cookie: {
        maxAge: 1000 * 60 * 60 * 3, // 3 hours
        httpOnly: true, // you can access the cookie in the javascript front end
        secure: __prod__, // cookie only works in https
        /*sameSite: "none",*/ // csrf
      },
      saveUninitialized: false,
      secret: "J@k0d0ng0",
      resave: false,
    })
  );

  const apolloServer = new ApolloServer({
    schema: await buildSchema({
      resolvers: [PostsResolver, UserResolver],
      validate: false,
    }),
    context: ({ req, res }) => ({ em: orm.em, req, res, redis }),
  });

  await apolloServer.start();
  apolloServer.applyMiddleware({ app, cors: false});

  // https://studio.apollographql.com
  // http://localhost:3000

  app.listen(4000, () => {
    console.log("Server started on localhost: 4000");
  });
};

main().catch((err) => console.log(err));
