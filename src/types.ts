import { EntityManager, IDatabaseDriver, Connection } from "@mikro-orm/core"
import {Request, Response, Express} from 'express'
import {Redis} from "ioredis"

export type MyContext = {
    em: EntityManager<IDatabaseDriver<Connection>>
    req: Request
    res: Response
    redis: Redis
}
