import { FORGET_PASSWORD_PREFIX } from './../constants';
import { MyContext } from './../types';
import { Arg, Ctx, Field, Mutation, ObjectType, Query, Resolver } from "type-graphql";
import argon2 from 'argon2'
import { User } from '../entities/User';

import { EntityManager } from '@mikro-orm/postgresql';
import { COOKIE_NAME } from '../constants';
import { UsernamePasswordInput } from './UsernamePasswordInput';
import { validateRegister } from '../utils/validateRegister';
import { sendEmail } from '../utils/sendEmail';
import {v4} from 'uuid'

@ObjectType()
class FieldError {
    @Field()
    field: string
    @Field()
    message: string
}

@ObjectType()
class UserResponse {
    @Field(() => [FieldError], {nullable: true})
    errors?: FieldError[]

    @Field(() => User, {nullable: true})
    user?: User
}

@Resolver()
export class UserResolver {
    @Mutation(() => UserResponse)
    async changePassword(
        @Arg('token') token: string,
        @Arg('newPassword') newPassword: string,
        @Ctx() {redis, req}: MyContext
    ): Promise<UserResponse> {
        if (newPassword.length <= 2) {
            return {
                errors: [{
                    field: 'newPassword',
                    message: 'Password must be at least 2 characters'
                }]
            }
        }

        const userId = await redis.get(`${FORGET_PASSWORD_PREFIX}${token}`)
        if (!userId) {
            return {
                errors: [{
                    field: 'token',
                    message: 'Token expired'
                }]
            }
        }
        const userIdNum = parseInt(userId, 10)
        const user = await User.findOne(userIdNum)
        if (!user) {
            return {
                errors: [{
                    field: 'token',
                    message: 'User do not exist'
                }]
            }
        }

        await User.update({id: userIdNum.toString()}, {password: await argon2.hash(newPassword)})
        await redis.del(`${FORGET_PASSWORD_PREFIX}${token}`)
        req.session.userId = user.id
        return {user}
    }

    @Mutation(() => Boolean)
    async forgotPassword(
        @Arg('email') email: string,
        @Ctx() {redis}: MyContext
    ) {
        const user = await User.findOne({where: {email}})
        if (!user) {
            return true
        }

        const token = v4()
        await redis.set(`${FORGET_PASSWORD_PREFIX}${token}`, user.id, 'EX', 1000 * 60 * 60 * 25 * 3)
        await sendEmail(email, `<a href="http://localhost:3000/change-password/${token}" >reset password </a>`)

        return true
    }

    @Query(() => [User])
    users(): Promise<User[]> {
        return User.find()
    }

    @Query(() => User, {nullable: true})
    async me(@Ctx() {req}: MyContext) {
        if (!req.session.userId) {
            return null
        }

        const user  = await User.findOne(req.session.userId)
        return user
    }

    @Mutation(() => UserResponse)
    async register(
        @Arg('options') {username, password, email}: UsernamePasswordInput,
        @Ctx() {req, dataSource}: MyContext
    ): Promise<UserResponse> {

        const errors = validateRegister({username, password, email})
        if (errors) return {errors}


        const hashedPassword = await argon2.hash(password)
        let user;
        try {

            const result = await dataSource
                .createQueryBuilder()
                .insert()
                .into(User)
                .values([
                    { username, email, password: hashedPassword },
                ])
                .returning('*')
            console.log(result)



            console.log('result[0] =:>> ', result[0]);
            const retrivedUser = result.generatedMaps
            user = {
                ...retrivedUser,
                createdAt: retrivedUser.created_at,
                updatedAt: retrivedUser.updated_at
            };
        } catch (error) {
            console.error(error.message)
            if (error.detail.includes("already exists")) {
                return {
                    errors:[{
                        field:"username",
                        message: "username already taken"
                    }]
                }
            }
        }

        req.session.userId = user.id

        return {user}
    }

    @Mutation(() => UserResponse)
    async login(
        @Arg('usernameOrEmail') usernameOrEmail: string,
        @Arg('password') password: string,
        @Ctx() {em, req}: MyContext
    ): Promise<UserResponse> {
        const user = await em.findOne(
            User,
            usernameOrEmail.includes('@')
                ? {email: usernameOrEmail}
                : {username: usernameOrEmail}
        )
        if (!user) {
            return {
                errors: [{
                    field: "usernameOrEmail",
                    message: "that user name doesn't exist"
                }]
            }
        }
        const valid = await argon2.verify(user.password, password)
        if (!valid) {
            return {
                errors: [{
                    field: "password",
                    message: "incorrect password"
                }]
            }
        }

        req.session.userId = user.id
        return {user}
    }

    @Mutation(() => Boolean)
    async logout( @Ctx() {req, res}: MyContext) {
        return new Promise((resolve) => req.session.destroy(err => {
            res.clearCookie(COOKIE_NAME)
            if (err) {
                console.error(err)
                resolve(false)
                return
            }
            resolve(true)
        }))
    }
}
