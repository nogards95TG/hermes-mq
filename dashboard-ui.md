Perfetto! Creo un todo completo con tutto il lavoro fatto e quello che resta da fare:

Update Todos

✅ COMPLETATO - Fase 1: Cleanup codice morto (-413 linee)

✅ COMPLETATO - Fase 2: Fix bugs (messageCount, handler performance, subscriber)

✅ COMPLETATO - Fase 3.1: Timeout events in RpcClient

TODO - Fase 3.2a: Connection events in RpcClient (connect/disconnect/error)

TODO - Fase 3.2b: Connection events in RpcServer

TODO - Fase 3.2c: Connection events in Publisher

TODO - Fase 3.2d: Connection events in Subscriber

TODO - Fase 3.3: Service lifecycle automatico (emitServiceStarted/Stopped in start/stop)

TODO - Fase 3.4: Response Sent event in RpcServer (dopo sendToQueue)
Perfetto! Ora creo un documento di riepilogo con le istruzioni per riprendere:

📋 DEBUG DASHBOARD REFACTORING - STATO ATTUALE
✅ LAVORO COMPLETATO
FASE 1 - CLEANUP CODICE MORTO ✅
Risultato: -413 linee rimosse

✅ API REST eliminate (-55 linee)

Rimossi 6 endpoint HTTP inutilizzati
File: src/debug/DebugServer.ts
✅ WebSocket handlers semplificati (-25 linee)

Da 4 handler a 1 (solo clear-messages)
File: src/debug/DebugServer.ts
✅ performanceData Map rimossa (-15 linee)

Map ridondante eliminata
File: src/debug/MessageStore.ts
✅ Filtri MessageStore semplificati (-35 linee)

Da 8 a 4 parametri filter
File: src/debug/MessageStore.ts
✅ DebugConnectionHealth rimosso (-103 linee)

Interfaccia, metodi e property eliminati
File: src/debug/types.ts, src/debug/DebugServer.ts, src/index.ts
✅ Test aggiornati (-179 linee)

Rimossi test obsoleti
File: **tests**/debug/DebugServer.test.ts, **tests**/debug/MessageStore.test.ts
FASE 2 - FIX BUGS E OTTIMIZZAZIONI ✅
Risultato: 3 bug fix + ottimizzazioni performance

✅ Fix service messageCount (+10 linee)

Counter ora funziona correttamente
Broadcast real-time su update
File: src/debug/DebugServer.ts:599-609
✅ Handler Performance pre-calcolata (+8 linee)

Dati mandati via WebSocket (no ricalcolo client)
Aggiunto a initial-data e broadcast
File: src/debug/DebugServer.ts:155, 316-322
✅ Subscriber events standardizzati (0 linee, solo refactor)

Parametri uniformati tra i due branch
File: src/server/pubsub/Subscriber.ts:610-632
FASE 3.1 - TIMEOUT EVENTS ✅
Risultato: RpcClient ora emette timeout events

✅ Timeout event in RpcClient (+9 linee)
emitMessageTimeout() quando scade timeout
File: src/client/rpc/RpcClient.ts:277-285
🚧 LAVORO RIMANENTE (DA RIPRENDERE)
FASE 3.2 - CONNECTION EVENTS (da fare)
Obiettivo: Tutti i componenti devono emettere eventi di connessione

Per ogni componente (RpcClient, RpcServer, Publisher, Subscriber):

// Da aggiungere in constructor/init o metodo connect
this.connectionManager.on('connected', () => {
if (this.debugEmitter) {
this.debugEmitter.emitConnectionConnected({
url: this.config.connection.url,
message: 'Connected to RabbitMQ'
});
}
});

this.connectionManager.on('disconnected', () => {
if (this.debugEmitter) {
this.debugEmitter.emitConnectionDisconnected({
message: 'Disconnected from RabbitMQ'
});
}
});

this.connectionManager.on('error', (error) => {
if (this.debugEmitter) {
this.debugEmitter.emitConnectionError({
error,
message: 'Connection error'
});
}
});
File da modificare:

src/client/rpc/RpcClient.ts
src/server/rpc/RpcServer.ts
src/client/pubsub/Publisher.ts
src/server/pubsub/Subscriber.ts
Note: Verificare che ConnectionManager emetta questi eventi (potrebbe richiedere modifiche anche lì)

FASE 3.3 - SERVICE LIFECYCLE AUTOMATICO (da fare)
Obiettivo: Emettere automaticamente eventi start/stop

Per ogni componente:

// In start()
async start(): Promise<void> {
await this.connectionManager.connect();
// ... setup ...

if (this.debugEmitter) {
this.debugEmitter.emitServiceStarted({
id: this.serviceId,
type: 'rpc-client', // o rpc-server, publisher, subscriber
name: this.config.queueName,
status: 'active',
startedAt: new Date(),
messageCount: 0
});
}
}

// In stop()
async stop(): Promise<void> {
if (this.debugEmitter) {
this.debugEmitter.emitServiceStopped(this.serviceId);
}

await this.channel?.close();
// ...
}
File da modificare:

src/client/rpc/RpcClient.ts
src/server/rpc/RpcServer.ts
src/client/pubsub/Publisher.ts
src/server/pubsub/Subscriber.ts
FASE 3.4 - RESPONSE SENT IN RPCSERVER (da fare)
Obiettivo: Tracciare quando RpcServer invia risposta

// In RpcServer, dopo sendToQueue della risposta
await channel.sendToQueue(
msg.properties.replyTo,
responsePayload,
options
);

// ✅ AGGIUNGERE
if (this.debugEmitter) {
this.debugEmitter.emitMessageSent({
id: msg.properties.messageId || msg.properties.correlationId,
type: 'rpc-response',
queue: msg.properties.replyTo,
command: command,
correlationId: msg.properties.correlationId,
payload: response,
metadata: { duration }
});
}
File da modificare:

src/server/rpc/RpcServer.ts (cercare sendToQueue per trovare il punto esatto)
📊 METRICHE FINALI (attuale)
Metrica Valore
Linee rimosse -413
Linee aggiunte +27
Linee nette -386
Test passati 430/430 ✅
Build status ✅ Success
Copertura eventi 50% (5/10 tipi)
🎯 OBIETTIVO FINALE (dopo Fase 3 completa)
Metrica Target
Copertura eventi 100% (10/10 tipi)
Connection tracking ✅ Completo
Service lifecycle ✅ Automatico
RpcServer symmetry ✅ Request + Response
🚀 COME RIPRENDERE
Iniziare da Fase 3.2a: Connection events in RpcClient
Verificare ConnectionManager: Controllare se emette eventi connected, disconnected, error
Procedere sequenzialmente: 3.2a → 3.2b → 3.2c → 3.2d → 3.3 → 3.4
Testare dopo ogni fase: npm run build && npm test
Commit incrementali: Dopo ogni sottofase completata
Stato attuale salvato con successo! ✅

Tutto pronto per riprendere dalla Fase 3.2 🚀
