import {Application, Router} from "../mod.ts";

const app = new Application();
const router = new Router()


const books = new Map<string, any>()
books.set('1', {
    id: "1",
    title: "《XinHuaCiDian》",
    author: "Chinese"
})

router.get('/book', (ctx) => {
    ctx.response.body = Array.from(books.values())
})
    .get("/book/:id", (ctx) => {
        if (ctx.params && ctx.params.id && books.has(ctx.params.id)) {
            ctx.response.body = books.get(ctx.params.id)
        }
    })

const routes = router.routes()

app.use(routes)

// https://github.com/oakserver/oak#basic-usage router-usage
app.use((ctx) => {
    console.info('router instance==>', router);
    console.info('routes==>', routes);
    ctx.response.body = "Hello world!";
});

await app.listen("127.0.0.1:8000");
