self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
    event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', () => {});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const chatId = event.notification?.data?.chatId || '';
    event.waitUntil((async () => {
        const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of allClients) {
            if ('focus' in client) {
                await client.focus();
                if (chatId) client.postMessage({ type: 'uwu-open-chat', chatId });
                return;
            }
        }
        if (self.clients.openWindow) {
            const url = chatId ? `./?openChat=${encodeURIComponent(chatId)}` : './';
            await self.clients.openWindow(url);
        }
    })());
});
