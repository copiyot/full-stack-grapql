import { Resolver, Mutation, Arg, Field, Ctx, ObjectType, Query} from "type-graphql";
import argon2 from "argon2";
import "express-session";
// import {EntityManager} from "@mikro-orm/postgresql";

import { MyContext } from "src/types";
import { User } from "../entities/User";
import { COOKIE_NAME, FORGET_PASSWORD_PREFIX } from "../constants";
import { UsernamePasswordInput } from "./UsernamePasswordInput";
import { validateRegister } from "../utils/validateRegister";
import { sendEmail } from "../utils/sendEmail";
import { v4 } from "uuid";


declare module "express-session"{
    interface SessionData {
        userId: number
    }
}

@ObjectType()
class FieldError {
    @Field()
    field: string;

    @Field()
    message: string;
}

@ObjectType()
class UserResponse {
    @Field(() => [FieldError], {nullable: true})
    errors?: FieldError[];

    @Field(() => User, {nullable: true})
    user?: User
}


@Resolver()
export class UserResolver {
    @Mutation(() => Boolean)
    async forgotPassword(
        @Arg('email') email: string,
        @Ctx() {em, redis}: MyContext
    ){
        const user = await em.findOne(User, {email});
        if(!user){
            return true;
        }

        const token = v4();

        await redis.set(FORGET_PASSWORD_PREFIX + token, user.id, 'EX', 1000*60*60*24*3)// 3 days

        await sendEmail(email, `<a href="http://localhost:3000/change-password/${token}">reset password</a>`)
        return true;
    }

    @Query(() => User, {nullable: true})
    async Me(
        @Ctx() {req, em}: MyContext
    ){
        //you are not logged in
        if(!req.session.userId){
            return null;
        }

        const user = await em.findOne(User, {id: req.session.userId});
        return user;
    }

    @Mutation(() => UserResponse)
    async register(
        @Arg('options') options: UsernamePasswordInput,
        @Ctx() {em, req}: MyContext
    ): Promise<UserResponse>{
       const errors = validateRegister(options);
       if(errors){
        return { errors };
       }

        const hashedPassword = await argon2.hash(options.password);
        const user = em.create(User, {username: options.username, password: hashedPassword, email: options.email});
        // let user;
        try {
            // const response = await (em as EntityManager).createQueryBuilder(User).getKnexQuery().insert({
            //     username: options.username,
            //     password: hashedPassword,
            //     created_at: new Date(),
            //     updated_at: new Date()
            // }).returning("*");
            await em.persistAndFlush(user);
            // user = response[0];
        } catch (err){
            // err.code === "23505"
            if(err.detail.includes("already exists")){
                return {
                    errors: [{
                        field: "username",
                        message: "username already taken"
                    }]
                }
            }
        }

        req.session.userId = user.id;

        return {user};
    }

    @Mutation(() => UserResponse)
    async login(
        @Arg('usernameOrEmail') usernameOrEmail: string,
        @Arg('password') password: string,
        @Ctx() {em, req}: MyContext
    ): Promise<UserResponse>{
        const user = await em.findOne(User, usernameOrEmail.includes('@') ? {email: usernameOrEmail} : {username: usernameOrEmail});

        if(!user){
            return {
                errors: [{
                    field: "usernameOrEmail",
                    message: "username or Email doesn't exist"
                }]
            }
        }
        const valid = await argon2.verify(user.password, password);

        if(!valid){
            return {
                errors: [{
                    field: "password",
                    message: "incorrect password"
                }]
            }
        }

        req.session.userId = user.id;

        return {user};
    }

    @Mutation(() => Boolean)
    logout(
        @Ctx() {req, res}: MyContext
    ){
        return new Promise(resolve => req.session.destroy( err => {
            res.clearCookie(COOKIE_NAME);
            if(err){
                console.log(err)
                resolve(false);
                return
            }

            resolve(true)
        }))
    }
}