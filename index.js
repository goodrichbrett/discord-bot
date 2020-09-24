require('dotenv').config();

const { Client, Util } = require('discord.js');
const { PreconditionFailed } = require('http-errors');
const ytdl = require('ytdl-core');
const YouTube = require('simple-youtube-api');
const PREFIX = '!';

const client = new Client({ disableEveryone: true });

const youtube = new YouTube(process.env.GOOGLE_API_KEY);

const queue = new Map();

client.on('ready', () => console.log('Active'));

client.on('message', async (message) => {
	if (message.author.bot) return;
	if (!message.content.startsWith(PREFIX)) return;

	const args = message.content.substring(PREFIX.length).split(' ');
	const searchString = args.slice(1).join(' ');
	const url = args[1] ? args[1].replace(/<(.+)>/g, '$1') : '';
	const serverQueue = queue.get(message.guild.id);

	if (message.content.startsWith(`${PREFIX}play`)) {
		if (message.content.length < 8) return message.channel.send('Fuck off');
		const voiceChannel = message.member.voice.channel;
		if (!voiceChannel)
			return message.channel.send(
				'You need to be in a voice channel to play music'
			);
		const permissions = voiceChannel.permissionsFor(message.client.user);
		if (!permissions.has('CONNECT'))
			return message.channel.send(
				"I don't have permissions to connect to the voice channel"
			);
		if (!permissions.has('SPEAK'))
			return message.channel.send(
				"I don't have permissions to speak in the channel"
			);
		if (
			url.match(
				/^https?:\/\/(www.youtube.com|youtube.com)\/playlist(.*)$/
			)
		) {
			const playList = await youtube.getPlaylist(url);
			const videos = await playList.getVideos();
			for (const video of Object.values(videos)) {
				const video2 = await youtube.getVideoByID(video.id);
				await handleVideo(video2, message, voiceChannel, true);
			}
		} else {
			try {
				var video = await youtube.getVideoByID(url);
			} catch {
				try {
					var videos = await youtube.searchVideos(searchString);
					var video = await youtube.getVideoByID(videos[0].id);
				} catch {
					return message.channel.send('Unable to find song');
				}
			}
			return handleVideo(video, message, voiceChannel);
		}
	} else if (message.content.startsWith(`${PREFIX}stop`)) {
		if (!message.member.voice.channel)
			return message.channel.send(
				'You need to be in a voice channel to stop the music'
			);
		if (!serverQueue)
			return message.channel.send('There is nothing playing');
		serverQueue.songs = [];
		serverQueue.connection.dispatcher.end();
		message.channel.send('I have stopped playing the music for you');
		return undefined;
	} else if (message.content.startsWith(`${PREFIX}skip`)) {
		if (!message.member.voice.channel)
			return message.channel.send(
				'You need to be in a voice channel to skip a song'
			);
		if (!serverQueue)
			return message.channel.send('There is nothing to skip');
		serverQueue.connection.dispatcher.end();
		message.channel.send('I have skipped the music for you');
		return undefined;
	} else if (message.content.startsWith(`${PREFIX}volume`)) {
		if (!message.member.voice.channel)
			return message.channel.send(
				'You need to be in a voice channel to use music commands'
			);
		if (!serverQueue)
			return message.channel.send('There is nothing playing');
		if (!args[1])
			return message.channel.send(
				`That volume is **${serverQueue.volume}`
			);
		if (isNaN(args[1]))
			return message.channel.send('That is not a valid number');
		serverQueue.volume = args[1];
		serverQueue.connection.dispatcher.setVolumeLogarithmic(args[1]);
		message.channel.send(`Volume is now **${args[1]}**`);
		return undefined;
	} else if (message.content.startsWith(`${PREFIX}np`)) {
		if (!serverQueue)
			return message.channel.send('There is nothing playing');
		message.channel.send(`Now playing **${serverQueue.songs[0].title}**`);
	} else if (message.content.startsWith(`${PREFIX}queue`)) {
		if (!serverQueue)
			return message.channel.send('There is nothing playing');
		message.channel.send(
			`**Song queue: ${serverQueue.songs
				.map((song) => `**-** ${song.title}`)
				.join(`\n`)}
				**Now playing:** ${serverQueue.songs[0].title}`,
			{ split: true }
		);
		return undefined;
	} else if (message.content.startsWith(`${PREFIX}pause`)) {
		if (!message.member.voice.channel)
			return message.channel.send(
				'You need to be in a voice channel to use music commands'
			);
		if (!serverQueue)
			return message.channel.send('There is nothing playing');
		if (!serverQueue.playing)
			return message.channel.send('The music is already paused');
		serverQueue.playing = false;
		serverQueue.connection.dispatcher.pause();
		message.channel.send('Song is now paused');
		return undefined;
	} else if (message.content.startsWith(`${PREFIX}resume`)) {
		if (!message.member.voice.channel)
			return message.channel.send(
				'You need to be in a voice channel to use music commands'
			);
		if (!serverQueue)
			return message.channel.send('There is no music playing');
		if (serverQueue.playing)
			return message.channel.send('Music is already playing');
		serverQueue.playing = true;
		serverQueue.connection.dispatcher.resume();
		message.channel.send('Music is now playing');
		return undefined;
	}
	return undefined;
});

async function handleVideo(video, message, voiceChannel, playList = false) {
	const serverQueue = queue.get(message.guild.id);
	const song = {
		id: video.id,
		title: video.title,
		url: `https://www.youtube.com/watch?v=${video.id}`,
	};

	if (!serverQueue) {
		const queueConstruct = {
			textChannel: message.channel,
			voiceChannel: voiceChannel,
			connection: null,
			songs: [],
			volume: 5,
			playing: true,
		};
		queue.set(message.guild.id, queueConstruct);
		queueConstruct.songs.push(song);

		try {
			var connection = await voiceChannel.join();
			queueConstruct.connection = connection;
			play(message.guild, queueConstruct.songs[0]);
		} catch (error) {
			console.log(
				`There was an error connecting to the voice channel:  ${error}`
			);
			queue.delete(message.guild.id);
			return message.channel.send(
				`There was an error connecting to the voice channel: ${error}`
			);
		}
	} else {
		serverQueue.songs.push(song);
		if (playList) return undefined;
		else
			return message.channel.send(
				`**${song.title}** has been added to the queue`
			);
	}
	return undefined;
}

function play(guild, song) {
	const serverQueue = queue.get(guild.id);

	if (!song) {
		serverQueue.voiceChannel.leave();
		queue.delete(guild.id);
		return;
	}

	const dispatcher = serverQueue.connection
		.play(ytdl(song.url))
		.on('finish', () => {
			serverQueue.songs.shift();
			play(guild, serverQueue.songs[0]);
		})
		.on('error', (error) => {
			console.log(error);
		});
	dispatcher.setVolumeLogarithmic(serverQueue.volume / 5);

	serverQueue.textChannel.send(`**${song.title}** has started playing,\n**MAURICE COME BACK, YOU CAN BLAME IT ALL ON ERIC**`);
}

client.login(process.env.TOKEN);

// comment
