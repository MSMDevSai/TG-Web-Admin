function switchView(v) {
    activeView = v;
    document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === v));
    lastChatsHash = '';
    renderChatList(allChats);
}

function setTab(t) {
    activeTab = t;
    document.querySelectorAll('.ftab').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
    lastChatsHash = '';
    renderChatList(allChats);
}
