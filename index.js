require('dotenv').config();

const Telegraf = require('telegraf');
const session = require('telegraf/session');
const Extra = require('telegraf/extra');
const Markup = require('telegraf/markup');
const Stage = require('telegraf/stage');
const Scene = require('telegraf/scenes/base');
const { GoogleSpreadsheet } = require('google-spreadsheet');

const atob = (data) => Buffer.from(data, 'base64').toString('utf-8');
const btoa = (data) => Buffer.from(data, 'utf-8').toString('base64');

const doc = new GoogleSpreadsheet(process.env.SPREADSHEET_ID);
const bot = new Telegraf(process.env.BOT_TOKEN);

(async function() {
  await doc.useServiceAccountAuth({
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/gm, '\n'),
  });
}());

const getRows = async function() {
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle['Wishlist'];
  return await sheet.getRows();
}

const getFullName = (user) => user.first_name + (user.last_name ? ' '+user.last_name : '');

const addWishScene = new Scene('addWishScene');
addWishScene.enter((ctx) => ctx.reply('Напишите свое новое желание'));
addWishScene.on('text', async (ctx) => {
  await addWish(ctx);
  ctx.scene.leave();
  myWishesMenu(ctx);
});

const deleteWishScene = new Scene('deleteWishScene');
deleteWishScene.enter((ctx) => ctx.reply('Введите номер желания, которое хотите удалить.\n❗️Ваш Санта увидит изменения в списке только тогда, когда запросит его заново.'));
deleteWishScene.on('text', async (ctx) => {
  const wishListLength = await getWishesList(getFullName(ctx.message.from)).length;
  const deleteWishIdx = Number(ctx.message.text);

  if ( deleteWishIdx.toString() !== ctx.message.text.toString()) {
    ctx.reply('Введите цифру!');
  } else if (deleteWishIdx > wishListLength || deleteWishIdx < 1 || !Number.isInteger(deleteWishIdx)) {
    ctx.reply('Желания под таким номером не существует! Введите корректное число.');
  } else {
    await deleteWish(ctx, deleteWishIdx);
    ctx.scene.leave();
    myWishesMenu(ctx);
  }
});

const getWishesList = async function(userId) {
  const rows = await getRows();
  const user = rows.find((row) => row.id === userId);
  return user.gifts ? atob(user.gifts).split('|;|') : [];
}

const addWish = async function(ctx) {
  const fullName = getFullName(ctx.message.from);
  const rows = await getRows();
  const userIdx = rows.findIndex((row) => row.id === fullName);
  rows[userIdx].gifts = rows[userIdx].gifts
    ? btoa(atob(rows[userIdx].gifts) + '|;|' + ctx.message.text)
    : btoa(ctx.message.text);
  await rows[userIdx].save();
}

const deleteWish = async function(ctx, deleteWishIdx) {
  const fullName = getFullName(ctx.message.from);

  const rows = await getRows();
  const userIdx = rows.findIndex((row) => row.id === fullName);

  const wishList = atob(rows[userIdx].gifts).split('|;|');
  wishList.splice(deleteWishIdx - 1, 1);
  rows[userIdx].gifts = btoa(wishList.join('|;|'));
  await rows[userIdx].save();
}

const getUserSanta = async function(userId) {
  const rows = await getRows();
  const user = rows.find((row) => row.id === userId);
  return user.secretSantaFor ? atob(user.secretSantaFor) : '';
}

const getUserList = async function() {
  const rows = await getRows();
  return rows.map((row) => row.id);
}

const setSecretSanta = async function(userId, secretSanta) {
  const rows = await getRows();
  const userIdx = rows.findIndex((row) => row.id === userId);
  rows[userIdx].secretSantaFor = btoa(secretSanta);
  rows[userIdx].save();
}

bot.use(session());

const stage = new Stage();
stage.register(addWishScene);
stage.register(deleteWishScene);
bot.use(stage.middleware());


const welcomeKeyboard = Markup.keyboard([
  ['🎁 Мой список желаний'],
  ['🎈 Список желаний другого']
]);

const welcomeMessage = (ctx) => `
Привет, ${ctx.message.from.first_name}!

Учавствуешь в Секретном Санте, но *не знаешь, что подарить*?

Боишься, что не сможешь счастливо улыбнуться, когда увидишь собственный подарок?😥

✨*Выход есть!*✨

Напиши свой *список желаний* и твой Секретный Санта его увидит!😉
`;

bot.start((ctx) => {
  ctx.replyWithMarkdown(
    welcomeMessage(ctx),
    Extra.markup(welcomeKeyboard.oneTime().resize())
  );
});

const myWishesMenu = async (ctx) => {
  const fullName = getFullName(ctx.message.from);
  const wishesList = await getWishesList(fullName);
  const count = wishesList.length;

  let wishesStr;
  if (count === 1) {
    wishesStr = 'желание';
  } else if (1 < count && count < 5) {
    wishesStr = 'желания';
  } else {
    wishesStr = 'желаний';
  }

  ctx.reply(`В вашем списке ${count} ${wishesStr}`,
    Extra.markup(Markup.keyboard([
      ['🤩 Добавить желание'],
      ['🤔 Посмотреть указанные'],
      ['Назад в главное меню']
    ]).oneTime().resize()));
}

const seeWishesMenu = async (ctx) => {
  const fullName = getFullName(ctx.message.from);
  const wishesList = await getWishesList(fullName);

  const wishesStr = wishesList.map((wish, idx) => `${idx + 1}) ${wish}`).join('\n');

  ctx.replyWithMarkdown(`*Мои желания:* \n\n${wishesStr}`,
    Extra.markup(Markup.keyboard([
      ['🤩 Добавить желание'],
      ['❌ Удалить желание'],
      ['Назад в главное меню']
    ]).oneTime().resize()));
}

const anotherPersonWishListMenu = async (ctx) => {
  const fullName = getFullName(ctx.message.from);
  const secretSantaFor = await getUserSanta(fullName);

  if (secretSantaFor) {
    const wishesList = await getWishesList(secretSantaFor);
    const wishesStr = wishesList.map((wish, idx) => `${idx + 1}) ${wish}`).join('\n');
    ctx.reply(`Вы Секретный Санта для ${secretSantaFor}:\n\nСписок желаний:\n${wishesStr}`,
      Extra.markup(Markup.keyboard(['Назад в главное меню']).oneTime().resize())
    );
  } else {
    const usersList = await getUserList();
    const users = usersList.map((name) => [Markup.callbackButton(name, `user-${name}-${fullName}`)]);
    ctx.reply('🕵🏻 Вы еще не указали человека, для которого являетесь Секретным Сантой. Выберите его из списка.',
      Extra.markup(Markup.inlineKeyboard(users))
    );
  }
}

bot.hears('🎁 Мой список желаний', async (ctx) => myWishesMenu(ctx));
bot.hears('🎈 Список желаний другого', async (ctx) => anotherPersonWishListMenu(ctx));

bot.hears('🤩 Добавить желание', async (ctx) => ctx.scene.enter('addWishScene'));
bot.hears('🤔 Посмотреть указанные', async (ctx) => seeWishesMenu(ctx));
bot.hears('Назад в главное меню', (ctx) => ctx.reply('Вы находитесь в главном меню',
  Extra.markup(welcomeKeyboard.oneTime().resize()))
);
bot.hears('❌ Удалить желание', async (ctx) => ctx.scene.enter('deleteWishScene'));

bot.action(/^user-.*$/, async (ctx) => {
  const [_, secretSantaFor, id] = ctx.match[0].split('-');
  setSecretSanta(id, secretSantaFor);

  const wishesList = await getWishesList(secretSantaFor);
  const wishesStr = wishesList.map((wish, idx) => `${idx + 1}) ${wish}`).join('\n');
  ctx.reply(`Вы Секретный Санта для ${secretSantaFor}:\n\nСписок желаний:\n${wishesStr}`,
    Extra.markup(Markup.keyboard(['Назад в главное меню']).oneTime().resize())
  );
});

bot.launch();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
