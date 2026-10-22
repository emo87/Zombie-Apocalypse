# Apocalisse a Domicilio — prototipo v0.1

Co-op zombie comico, fino a 6 giocatori, ognuno dal proprio dispositivo (PC o telefono).

## Avvio in locale

```bash
npm install
npm start
```

Apri `http://localhost:3000`, crea una stanza e passa il codice (o il link con "Invita amici") agli amici.
Per giocare da internet senza hosting: `ngrok http 3000` e condividi il link `https://...`.

## Comandi

- **PC**: WASD / frecce per muoversi, mouse per mirare, clic (tenuto) per sparare, tasti 1-4 per le urla veloci.
- **Telefono**: metà sinistra dello schermo = joystick di movimento, metà destra = joystick di mira (spara mentre lo tieni).
- **Rianimare**: stai vicino a un amico a terra per circa 2,5 secondi.

## Stato attuale (cosa c'è)

- Stanze con codice di 4 lettere, lobby, host che avvia la partita, ingresso anche a partita in corso
- Server autoritativo (30 tick/s, snapshot a 15/s) con movimento, spari, scaffali come ostacoli
- Ondate a difficoltà crescente scalate sul numero di giocatori, pausa di 6 secondi tra le ondate
- Zombie: base, col cono in testa (più resistente), sposo (veloce), boss con corona ogni 5 ondate
- Rianimazione, punteggio per giocatore, game over e ricomincia
- Fumetti con urla rapide, nomi, barre di vita, controlli touch

## Prossimi passi (roadmap)

1. Giorno/notte: di giorno si raccolgono risorse e si barricano le entrate, di notte arrivano gli zombie
2. Ruoli veri (Tank con carrello, Cecchino, Cuoco con trappole, Meccanico, Medico, Rompiscatole)
3. Armi comiche (baguette, prosciutto gigante, pistola a pannocchie) e potenziamenti tra le ondate
4. Più tipi di zombie e boss con meccaniche (zombie-sposo con la sposa, zombie in pigiama)
5. Suoni ed effetti, particelle e screen shake
6. Interpolazione migliore, riconnessione, classifica globale

## Deploy su Render (gratis)

1. Crea un repository GitHub e carica il contenuto di questa cartella (il `.gitignore` esclude `node_modules`).
2. Su render.com: **New > Blueprint** (usa `render.yaml`) oppure **New > Web Service** con Build `npm install`, Start `npm start`, piano Free.
3. A deploy finito ottieni un link `https://nome.onrender.com`: passalo agli amici.

Note: il piano gratuito va a dormire dopo 15 minuti di inattività e riparte in circa un minuto, quindi apri il link un minuto prima di giocare. Durante la partita il server resta sveglio. Le stanze sono in memoria: se il server si riavvia, si perdono.
