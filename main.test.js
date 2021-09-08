const { Client, TextChannel, GuildMember, DiscordAPIError, Guild, Permissions } = require("discord.js");
jest.setTimeout(30 * 1000);
require('dotenv').config()
const { MANAGER_TOKEN, CLIENT_TOKEN } = process.env;
/** @type {Guild} */
let m_guild;
/** @type {TextChannel} */
let m_channel, channel;
const manager = new Client({
  intents: ["GUILDS", "GUILD_MEMBERS"]
})
const client = new Client({
  intents: ["GUILDS", "GUILD_MESSAGES"]
});

manager.on("rateLimit", (d) => console.warn(d));

beforeAll(async () => {
  const TEXT_CHANNEL_NAME = "test-tc";
  await Promise.all([client.login(CLIENT_TOKEN), manager.login(MANAGER_TOKEN)]);
  await Promise.all(manager.guilds.cache.map(guild => guild.ownerId === manager.user.id && guild.delete()))

  m_guild = await manager.guilds.create("test", {
    channels: [{
      name: TEXT_CHANNEL_NAME,
      type: 0, // GUILD_TEXT
    }]
  });

  await m_guild.roles.everyone.edit({
    permissions: []
  });
  const m_role = await m_guild.roles.create({
    name: "manage guild",
    permissions: ["MANAGE_GUILD"]
  });
  const invite = await m_guild.invites.create(m_guild.channels.cache.find(ch => ch.name === TEXT_CHANNEL_NAME), {
    maxUses: 1
  });
  console.info("Waiting:", invite.url, client.generateInvite({
    guild: m_guild.id,
    scopes: ["bot"],
    disableGuildSelect: true,
    permissions: 0,
  }));
  const promises = [new Promise(resolve => {
    const handler = async (/** @type {GuildMember}*/m_member) => {
      console.log("member detected:", m_member.user.tag);
      if (m_member.id !== client.user.id) {
        await m_member.roles.add(m_role);
        return;
      }
      manager.off("guildMemberAdd", handler);
      resolve();
    };
    manager.on("guildMemberAdd", handler);
  }),
  new Promise(resolve => client.once("guildCreate", resolve))];
  await Promise.all(promises);
  /**@type {TextChannel[]} */
  [m_channel, channel] = [manager, client].map(e => e.channels.cache.find(ch => ch.guildId === m_guild.id && ch.name === TEXT_CHANNEL_NAME));
  if (!m_channel.isText() || !channel.isText()) {
    throw new Error();
  }
}, 10 * 60 * 1000);

function awaitEvent(client, name) {
  return new Promise((resolve) => client.once(name, (...args) => resolve(args)));
}
describe("message permissions", () => {
  afterEach(async () => {
    await Promise.all([m_channel.permissionOverwrites.set([]), awaitEvent(client, "channelUpdate")]);
    expect(channel.permissionsFor(client.user).toArray(true)).toStrictEqual([]);
  });

  it("Only VIEW_CHANNEL permission required to edit messages", async () => {
    await m_channel.permissionOverwrites.set([
      {
        allow: ["VIEW_CHANNEL", "SEND_MESSAGES"],
        id: client.user.id,
      }
    ]);
    const message = await channel.send("aaa");
    await message.edit("bbb");
    await Promise.all([m_channel.permissionOverwrites.set([
      {
        id: client.user.id,
        allow: ["VIEW_CHANNEL"]
      }
    ]),
    awaitEvent(client, "channelUpdate")]);

    expect(channel.permissionsFor(client.user).toArray(true)).toStrictEqual(["VIEW_CHANNEL"]);
    expect(message.editable).toBe(true);
    await message.edit("ccc");
    await Promise.all([m_channel.permissionOverwrites.set([
      {
        id: client.user.id,
        allow: []
      }
    ]),
    awaitEvent(client, "channelUpdate")]);

    expect(channel.permissionsFor(client.user).toArray(true)).toStrictEqual([]);
    expect(message.editable).toBe(false);
    const err = await message.edit("ddd").catch(err => err);
    expect(err).toEqual(expect.any(DiscordAPIError));
    expect(err.code).toBe(50001);
  });

  describe("VIEW_CHANNEL,MANAGE_MESSAGES permissions required to pin messages", () => {
    let message;
    beforeAll(async () => {
      await Promise.all([m_channel.permissionOverwrites.set([
        {
          allow: ["VIEW_CHANNEL"],
          id: client.user.id,
        }
      ]), awaitEvent(client, "channelUpdate")]);
      [, [message]] = await Promise.all([m_channel.send("aaa"), awaitEvent(client, "messageCreate")]);
    });
    it("VIEW_CHANNEL,MANAGE_MESSAGES", async () => {
      await Promise.all([m_channel.permissionOverwrites.set([
        {
          allow: ["VIEW_CHANNEL", "MANAGE_MESSAGES"],
          id: client.user.id,
        }
      ]), awaitEvent(client, "channelUpdate")]);
      expect(channel.permissionsFor(client.user).toArray(true)).toStrictEqual(["VIEW_CHANNEL", "MANAGE_MESSAGES"]);
      expect(message.pinnable).toBe(true);
      await message.pin();
      await message.unpin();
    });

    it("MANAGE_MESSAGES", async () => {
      await Promise.all([m_channel.permissionOverwrites.set([
        {
          id: client.user.id,
          allow: ["MANAGE_MESSAGES"]
        }
      ]),
      awaitEvent(client, "channelUpdate")]);
      expect(channel.permissionsFor(client.user).toArray(true)).toStrictEqual(["MANAGE_MESSAGES"]);
      expect(message.pinnable).toBe(false);
      const err = await message.pin().catch(err => err);
      expect(err).toEqual(expect.any(DiscordAPIError));
      expect(err.code).toBe(50001);
    });

    it("VIEW_CHANNEL", async () => {
      await Promise.all([m_channel.permissionOverwrites.set([
        {
          id: client.user.id,
          allow: ["VIEW_CHANNEL"]
        }
      ]),
      awaitEvent(client, "channelUpdate")]);
      expect(channel.permissionsFor(client.user).toArray(true)).toStrictEqual(["VIEW_CHANNEL"]);
      expect(message.pinnable).toBe(false);
      const err = await message.pin().catch(err => err);
      expect(err).toEqual(expect.any(DiscordAPIError));
      expect(err.code).toBe(50013);
    });
  });

  describe("VIEW_CHANNEL,MANAGE_MESSAGES permissions required to pin messages", () => {
    let message;
    beforeAll(async () => {
      await m_channel.permissionOverwrites.set([
        {
          allow: ["VIEW_CHANNEL"],
          id: client.user.id,
        }
      ]);
      [, [message]] = await Promise.all([m_channel.send("aaa"), awaitEvent(client, "messageCreate")]);
    });
    it("VIEW_CHANNEL,MANAGE_MESSAGES", async () => {
      await Promise.all([m_channel.permissionOverwrites.set([
        {
          allow: ["VIEW_CHANNEL", "MANAGE_MESSAGES"],
          id: client.user.id,
        }
      ]), awaitEvent(client, "channelUpdate")]);
      expect(channel.permissionsFor(client.user).toArray(true)).toStrictEqual(["VIEW_CHANNEL", "MANAGE_MESSAGES"]);
      expect(message.pinnable).toBe(true);
      await message.pin();
      await message.unpin();
    });

    it("MANAGE_MESSAGES", async () => {
      await Promise.all([m_channel.permissionOverwrites.set([
        {
          id: client.user.id,
          allow: ["MANAGE_MESSAGES"]
        }
      ]),
      awaitEvent(client, "channelUpdate")]);
      expect(channel.permissionsFor(client.user).toArray(true)).toStrictEqual(["MANAGE_MESSAGES"]);
      expect(message.pinnable).toBe(false);
      const err = await message.pin().catch(err => err);
      expect(err).toEqual(expect.any(DiscordAPIError));
      expect(err.code).toBe(50001);
    });

    it("VIEW_CHANNEL", async () => {
      await Promise.all([m_channel.permissionOverwrites.set([
        {
          id: client.user.id,
          allow: ["VIEW_CHANNEL"]
        }
      ]),
      awaitEvent(client, "channelUpdate")]);
      expect(channel.permissionsFor(client.user).toArray(true)).toStrictEqual(["VIEW_CHANNEL"]);
      expect(message.pinnable).toBe(false);
      const err = await message.pin().catch(err => err);
      expect(err).toEqual(expect.any(DiscordAPIError));
      expect(err.code).toBe(50013);
    });
  });

  describe("my messages can be deletable if has VIEW_CHANNEL permission", () => {
    it("VIEW_CHANNEL", async () => {
      await m_channel.permissionOverwrites.set([
        {
          id: client.user.id,
          allow: ["VIEW_CHANNEL", "SEND_MESSAGES"]
        }
      ]);
      const message = await channel.send("aaa");
      await Promise.all([m_channel.permissionOverwrites.set([
        {
          id: client.user.id,
          allow: ["VIEW_CHANNEL"]
        }
      ]),
      awaitEvent(client, "channelUpdate")]);
      expect(channel.permissionsFor(client.user).toArray(true)).toStrictEqual(["VIEW_CHANNEL"]);
      expect(message.deletable).toBe(true);
      await message.delete();
    });

    it("nothing", async () => {
      await m_channel.permissionOverwrites.set([
        {
          id: client.user.id,
          allow: ["VIEW_CHANNEL", "SEND_MESSAGES"]
        }
      ]);
      const message = await channel.send("aaa");
      await Promise.all([m_channel.permissionOverwrites.set([
        {
          id: client.user.id,
          allow: []
        }
      ]),
      awaitEvent(client, "channelUpdate")]);
      expect(channel.permissionsFor(client.user).toArray(true)).toStrictEqual([]);
      expect(message.deletable).toBe(false);
      const err = await message.delete().catch(err => err);
      expect(err).toEqual(expect.any(DiscordAPIError));
      expect(err.code).toBe(50001);
    });
  });

  describe("other user's messages can be deletable if has VIEW_CHANNEL and MANAGE_MESSAGES permissions", () => {
    const setupMessage = async () => {
      await Promise.all([m_channel.permissionOverwrites.set([{
        id: client.user.id,
        allow: ["VIEW_CHANNEL"]
      }]), awaitEvent(client, "channelUpdate")]);

      const m = await Promise.all([
        awaitEvent(client, "messageCreate"),
        m_channel.send("aaa")
      ]).then(([[message]]) => message);
      await Promise.all([m_channel.permissionOverwrites.set([]), awaitEvent(client, "channelUpdate")]);
      return m;
    };

    it("VIEW_CHANNEL,MANAGE_MESSAGES", async () => {
      const message = await setupMessage();
      await Promise.all([m_channel.permissionOverwrites.set([
        {
          id: client.user.id,
          allow: ["VIEW_CHANNEL", "MANAGE_MESSAGES"]
        }
      ]),
      awaitEvent(client, "channelUpdate")]);
      expect(channel.permissionsFor(client.user).toArray(true)).toStrictEqual(["VIEW_CHANNEL", "MANAGE_MESSAGES"]);
      expect(message.deletable).toBe(true);
      await message.delete();
    });

    it("MANAGE_MESSAGES", async () => {
      const message = await setupMessage();

      await Promise.all([m_channel.permissionOverwrites.set([
        {
          id: client.user.id,
          allow: ["MANAGE_MESSAGES"]
        }
      ]),
      awaitEvent(client, "channelUpdate")]);
      expect(channel.permissionsFor(client.user).toArray(true)).toStrictEqual(["MANAGE_MESSAGES"]);
      expect(message.deletable).toBe(false);
      const err = await message.delete().catch(err => err);
      expect(err).toEqual(expect.any(DiscordAPIError));
      expect(err.code).toBe(50001);
    });

    it("VIEW_CHANNEL", async () => {
      const message = await setupMessage();
      await Promise.all([m_channel.permissionOverwrites.set([
        {
          id: client.user.id,
          allow: ["VIEW_CHANNEL"]
        }
      ]),
      awaitEvent(client, "channelUpdate")]);
      expect(channel.permissionsFor(client.user).toArray(true)).toStrictEqual(["VIEW_CHANNEL"]);
      expect(message.deletable).toBe(false);
      const err = await message.delete().catch(err => err);
      expect(err).toEqual(expect.any(DiscordAPIError));
      expect(err.code).toBe(50013);
    });
  });
});
describe("channel", () => {
  it("text", async () => {
    const CHANNEL_NAME = "will-delete-tc";
    const m_ch = await m_guild.channels.create(CHANNEL_NAME);
    await Promise.all([m_ch.permissionOverwrites.set([{
      id: client.user.id,
      allow: ["VIEW_CHANNEL"]
    }]), awaitEvent(client, "channelUpdate")]);
    /** @type {TextChannel} */
    const ch = client.channels.cache.find(ch => ch.name === CHANNEL_NAME);

    expect(ch.permissionsFor(client.user).toArray(true)).toStrictEqual(["VIEW_CHANNEL"]);
    expect(ch.deletable).toBe(false);
    const err = await ch.delete().catch(err => err);
    expect(err).toEqual(expect.any(DiscordAPIError));
    expect(err.code).toBe(50013);

    await Promise.all([m_ch.permissionOverwrites.set([{
      id: client.user.id,
      allow: ["MANAGE_CHANNELS"]
    }]), awaitEvent(client, "channelUpdate")]);

    expect(ch.permissionsFor(client.user).toArray(true)).toStrictEqual(["MANAGE_CHANNELS"]);
    expect(ch.deletable).toBe(false);
    const err2 = await ch.delete().catch(err => err);
    expect(err2).toEqual(expect.any(DiscordAPIError));
    expect(err2.code).toBe(50001);


    await Promise.all([m_ch.permissionOverwrites.set([{
      id: client.user.id,
      allow: ["VIEW_CHANNEL", "MANAGE_CHANNELS"]
    }]), awaitEvent(client, "channelUpdate")]);

    expect(ch.permissionsFor(client.user).bitfield).toBe(new Permissions(["MANAGE_CHANNELS", "VIEW_CHANNEL"]).bitfield);
    expect(ch.deletable).toBe(true);
    await ch.delete();
  });

  it("voice", async () => {
    const CHANNEL_NAME = "will-delete-vc";
    const m_ch = await m_guild.channels.create(CHANNEL_NAME, {
      type: "GUILD_VOICE"
    });
    await Promise.all([m_ch.permissionOverwrites.set([{
      id: client.user.id,
      allow: ["CONNECT"]
    }]), awaitEvent(client, "channelUpdate")]);
    /** @type {TextChannel} */
    const ch = client.channels.cache.find(ch => ch.name === CHANNEL_NAME);

    expect(ch.permissionsFor(client.user).toArray(true)).toStrictEqual(["CONNECT"]);
    expect(ch.deletable).toBe(false);
    const err = await ch.delete().catch(err => err);
    expect(err).toEqual(expect.any(DiscordAPIError));
    expect(err.code).toBe(50013);

    await Promise.all([m_ch.permissionOverwrites.set([{
      id: client.user.id,
      allow: ["MANAGE_CHANNELS"]
    }]), awaitEvent(client, "channelUpdate")]);

    expect(ch.permissionsFor(client.user).toArray(true)).toStrictEqual(["MANAGE_CHANNELS"]);
    expect(ch.deletable).toBe(false);
    const err2 = await ch.delete().catch(err => err);
    expect(err2).toEqual(expect.any(DiscordAPIError));
    expect(err2.code).toBe(50001);


    await Promise.all([m_ch.permissionOverwrites.set([{
      id: client.user.id,
      allow: ["CONNECT", "MANAGE_CHANNELS"]
    }]), awaitEvent(client, "channelUpdate")]);

    expect(ch.permissionsFor(client.user).bitfield).toBe(new Permissions(["MANAGE_CHANNELS", "CONNECT"]).bitfield);
    expect(ch.deletable).toBe(true);
    await ch.delete();
  });
});

afterAll(async () => {
  await m_guild.delete();
  client.destroy();
  manager.destroy();
});