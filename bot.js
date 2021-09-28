require('dotenv').config()

const {Client} = require('discord.js');
const intents = ['GUILDS', 'GUILD_MESSAGES', 'DIRECT_MESSAGES', 'GUILD_BANS', 'GUILD_EMOJIS_AND_STICKERS', 'GUILD_INTEGRATIONS', 'GUILD_WEBHOOKS', 'GUILD_INVITES', 'GUILD_VOICE_STATES', 'GUILD_MESSAGE_REACTIONS', 'GUILD_MESSAGE_TYPING', 'DIRECT_MESSAGE_REACTIONS', 'DIRECT_MESSAGE_TYPING', 'GUILD_PRESENCES', 'GUILD_MEMBERS'];
const path = require('path')
const { Sequelize, DataTypes, Op } = require('sequelize')

const client = new Client({ intents });
const sequelize = process.env.NODE_ENV === 'dev' ? 
new Sequelize({
  dialect: 'sqlite',
  storage: path.join (__dirname, 'members.sqlite3'),
  logging: false
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
  sequelize.define('Member', {
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
    tableName: 'members'
  })

  await sequelize.models.Member.sync()

  await sequelize.authenticate()
}  

const createMember = async (discordId) => {
  return await sequelize.models.Member.create({
    'discordId': discordId,
    'lastEnter': 0,
    'isActive': false,
    'time': 0
  })
}

const findMember = async (discordId) => {
  const member = await sequelize.models.Member.findOne({
    'where': {
      'discordId': { [Op.eq] : discordId }
    }
  })

  return member ?? await createMember(discordId)
}

const addMember = async (discordId) => {
  const date = new Date().getTime()

  console.log(`[ENTER]: ${discordId} entered at ${date}`)

  const member = await findMember(discordId)

  if (member.isActive) {
    return {
      'status': 'error',
      'message': 'You are already active'
    }
  }

  member.lastEnter = date
  member.isActive = true

  await member.save()

  return {
    'status': 'success',
    'message': `<@!${member.discordId}> has started working`
  }
}

const removeMember = async (discordId) => {
  const date = new Date().getTime()

  console.log(`[LEAVE]: ${discordId} left at ${date}`)

  const member = await findMember(discordId)

  if (!member.isActive) {
    return {
      'status': 'error',
      'message': 'You weren\'t even there'
    }
  }

  const delta = date - member.lastEnter

  member.isActive = false
  member.time += delta

  await member.save()

  return {
    'status': 'success',
    'message': `Congrats <@!${member.discordId}>, you have worked for another ${Math.floor(delta / 1000)} seconds`
  }
}

const createTimeout = async (discordId, channel) => {
  const timeoutId = setTimeout(async () => {
    channel.send(`<@!${discordId}> You have been here for ${Math.floor(ACTIVE_TIME / 1000 / 3600)} hours, please confirm that you're still active or your session will be terminated`)
  
    const confirmTimeout = setTimeout(async () => {
      const response = await removeMember(discordId)

      channel.send(response.message)
    }, CONFIRMATION_TIME)

    confirmationTimeoutIds.set(discordId, confirmTimeout)
  }, ACTIVE_TIME)

  timeoutIds.set(discordId, timeoutId)
}

client.login(process.env.TOKEN)

client.once('ready', () => {
  initDatabase()
  .then(() => console.log(`Logged in as ${client.user.tag}`))
  .catch(err => console.log(err))
});

client.on('messageCreate', async message => {
  const content = message.content.toLocaleLowerCase();

  if (content === '%enter') {
    const response = await addMember(message.author.id)

    await message.reply(response.message)

    if (response.status === 'success') {
      await createTimeout(message.author.id, message.channel)
    }
  }

  else if (content === '%leave') {
    const response = await removeMember(message.author.id)

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
    } else {
      message.reply('nothing to confirm lmao')
    }
  }

  else if (content === '%reset') {
    if (message.author.id !== process.env.OWNER_ID) {
      await message.reply('Admin only =))))')

      return
    }

    const memberList = await message.guild.members.fetch()

    for (let id of memberList.keys()) {
      const member = await findMember(id)

      member.lastEnter = 0
      member.isActive = 0
      member.time = 0

      await member.save()
    }

    console.log(`[RESET] Data has been reset for guild ${message.guild.name}`)

    await message.reply(`Data has been reset for ${memberList.size} members`)
  } 
  
  else if (content === '%list') {
    let response = "Current hours spent this week:\n"

    const memberList = await message.guild.members.fetch()

    for (let id of memberList.keys()) {
      const member = await findMember(id)
      const time = (member.time / 3600000).toPrecision(2);

      const user = memberList.get(id).user.tag

      response += `${user} has spent ${time} hours in the past week.\n`
    }

    await message.reply(response)
  }
});