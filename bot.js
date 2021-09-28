require('dotenv').config()

const {Client} = require('discord.js');
const { setPriority } = require('os');
const intents = ['GUILDS', 'GUILD_MESSAGES', 'DIRECT_MESSAGES', 'GUILD_BANS', 'GUILD_EMOJIS_AND_STICKERS', 'GUILD_INTEGRATIONS', 'GUILD_WEBHOOKS', 'GUILD_INVITES', 'GUILD_VOICE_STATES', 'GUILD_MESSAGE_REACTIONS', 'GUILD_MESSAGE_TYPING', 'DIRECT_MESSAGE_REACTIONS', 'DIRECT_MESSAGE_TYPING', 'GUILD_PRESENCES', 'GUILD_MEMBERS'];
const path = require('path')
const { Sequelize, DataTypes, Op } = require('sequelize')

const client = new Client({ intents });
const sequelize = process.env.NODE_ENV === 'dev' ? 
new Sequelize({
  dialect: 'sqlite',
  storage: path.join (__dirname, 'homo.sqlite3')
}) :
new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  }
})

const ACTIVE_TIME = 3 * 3600 * 1000 // 3 hours 
const CONFIRMATION_TIME = 15 * 60 * 1000 // 15 minutes 

const timeoutIds = new Map()
const confirmationTimeoutIds = new Map()

const initDatabase = async () => {
  sequelize.define('Homo', {
    discordId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    lastEnter: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false
    },
    time: {
      type: DataTypes.INTEGER,
      allowNull: false
    }
  }, {
    tableName: 'homoTable'
  })

  await sequelize.models.Homo.sync()

  await sequelize.authenticate()
}  

const createHomo = async (discordId) => {
  return await sequelize.models.Homo.create({
    'discordId': discordId,
    'lastEnter': 0,
    'isActive': false,
    'time': 0
  })
}

const findHomo = async (discordId) => {
  const homo =  await sequelize.models.Homo.findOne({
    'where': {
      'discordId': { [Op.eq] : discordId }
    }
  })

  return homo ?? await createHomo(discordId)
}

const addHomo = async (discordId) => {
  const date = new Date().getTime()

  console.log(`[ENTER]: ${discordId} entered at ${date}`)

  const homo = await findHomo(discordId)

  if (homo.isActive) {
    return {
      'status': 'error',
      'message': 'You are already active'
    }
  }

  homo.lastEnter = date
  homo.isActive = true

  await homo.save()

  return {
    'status': 'success',
    'message': `<@!${homo.discordId}> has joined the homo team`
  }
}

const removeHomo = async (discordId) => {
  const date = new Date().getTime()

  console.log(`[LEAVE]: ${discordId} left at ${date}`)

  const homo = await findHomo(discordId)

  if (!homo.isActive) {
    return {
      'status': 'error',
      'message': 'You weren\'t even there'
    }
  }

  const delta = date - homo.lastEnter

  homo.isActive = false
  homo.time += delta

  await homo.save()

  return {
    'status': 'success',
    'message': `Congrats <@!${homo.discordId}>, you have worked for another ${Math.floor(delta / 1000)} seconds`
  }
}

const createTimeout = async (discordId, channel) => {
  const timeoutId = setTimeout(async () => {
    channel.send(`<@!${discordId}> You have been here for ${Math.floor(ACTIVE_TIME / 1000 / 3600)} hours, please confirm that you're still active or your session will be terminated`)
  
    const confirmTimeout = setTimeout(async () => {
      const response = await removeHomo(discordId)

      channel.send(response.message)
    }, CONFIRMATION_TIME)

    confirmationTimeoutIds.set(discordId, confirmTimeout)
  }, ACTIVE_TIME)

  timeoutIds.set(discordId, timeoutId)
}

client.login(process.env.TOKEN)

client.once('ready', () => {
  initDatabase()
  .then(() => console.log(`${client.user.tag} is ready to count homosexuals`))
  .catch(err => console.log(err))
});

client.on('messageCreate', async message => {
  const content = message.content.toLocaleLowerCase();

  if (content === '%enter') {
    const response = await addHomo(message.author.id)

    await message.reply(response.message)

    if (response.status === 'success') {
      await createTimeout(message.author.id, message.channel)
    }
  }

  else if (content === '%leave') {
    const response = await removeHomo(message.author.id)

    await message.reply(response.message)

    if (response.status === 'success') {
      if (timeoutIds.has(message.author.id)) {
        clearTimeout(timeoutIds.get(message.author.id))
        timeoutIds.delete(message.author.id)
      }

      if (confirmationTimeoutIds.has(message.author.id)) {
        clearTimeout(confirmationTimeoutIds.get(message.author.id))
        confirmationTimeoutIds.delete(message.author.id)
      }
    }
  }

  else if (content === '%confirm') {
    if (confirmationTimeoutIds.has(message.author.id)) {
      clearTimeout(confirmationTimeoutIds.get(message.author.id))
      confirmationTimeoutIds.delete(message.author.id)

      clearTimeout(timeoutIds.get(message.author.id))
      timeoutIds.delete(message.author.id)

      await createTimeout(message.author.id, message.channel)
    }
  }

  else if (content === '%reset') {
    if (message.author.id !== process.env.OWNER_ID) {
      await message.reply('Fuck off')

      return
    }

    const guild = message.guild

    guild.members.cache.forEach(async ({id}) => {
      const homo = await findHomo(id)

      homo.lastEnter = 0
      homo.isActive = 0
      homo.time = 0

      await homo.save()
    })

    console.log(`[RESET] Data has been reset for guild ${guild.name}`)

    await message.reply(`Data has been reset for ${guild.members.cache.size} homos`)
  } else if (content === '%list') {
    const guild = message.guild
    let response = "Current hours spent this week:\n"

    console.table(guild.members.cache)

    console.log(typeof guild.members.cache)

    const map = message.guild.members.cache.keys()
    let iter = map.next()
    
    while (!iter.done) {
      console.log(iter.value)

      const homo = await findHomo(iter.value)
      const user = await client.users.fetch(iter.value).catch(console.error)

      const time = (homo.time / 3600000).toPrecision(2);

      response += `${user.username} has spent ${time} hours in the past week.\n`

      iter = map.next()
    }
    await message.reply(response)
  }
});