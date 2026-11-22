import { createGameHost, startGameHost } from '../framework/server.ts'

startGameHost(createGameHost({
  root: new URL('.', import.meta.url),
  files: ['index.html', 'style.css', 'main.js', 'game.js'],
  artDirectories: ['art'],
  aliases: { '/': 'index.html' }
}))
