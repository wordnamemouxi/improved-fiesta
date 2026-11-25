(() => {
    let pending;
    window.finishMouxiNotificationPermission = () => {
        pending?.(MouxiAndroid.permission());
        pending = null;
    };
    class AndroidNotification {
        static get permission() { return MouxiAndroid.permission(); }
        static requestPermission() {
            return new Promise(resolve => { pending = resolve; MouxiAndroid.askPermission(); });
        }
        constructor(title, opts) {
            MouxiAndroid.show(String(title), String(opts?.body || ''), String(opts?.data?.chatId || ''));
        }
        close() {}
    }
    window.Notification = AndroidNotification;
})();
