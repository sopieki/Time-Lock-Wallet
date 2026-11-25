const STORAGE_KEY = "timelock_wallet_data";

let walletData = null;
let pendingGoal = null;

const connectBtn = document.getElementById("connectBtn");
const createBtn = document.getElementById("createBtn");
const refreshBtn = document.getElementById("refreshBtn");
const networkBadge = document.getElementById("networkBadge");
const balanceBadge = document.getElementById("balanceBadge");
const statusBox = document.getElementById("statusBox");
const goalsList = document.getElementById("goalsList");
const goalForm = document.getElementById("goalForm");

const confirmModal = document.getElementById("confirmModal");
const confirmName = document.getElementById("confirmName");
const confirmAmount = document.getElementById("confirmAmount");
const confirmDate = document.getElementById("confirmDate");
const cancelFreezeBtn = document.getElementById("cancelFreezeBtn");
const confirmFreezeBtn = document.getElementById("confirmFreezeBtn");

function showStatus(message, type = "") {
  statusBox.textContent = message;
  statusBox.className = `status ${type}`;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(walletData));
}

function loadData() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    walletData = JSON.parse(saved);
    renderWalletUI();
    renderGoals();
  } else {
    connectBtn.textContent = "Создать кошелёк";
  }
}

function createOrOpenWallet() {
  if (walletData) {
    showStatus(`Ваш адрес: ${walletData.address} | Seed-фраза: ${walletData.mnemonic}`, "success");
    return;
  }

  const randomWallet = ethers.Wallet.createRandom();

  walletData = {
    address: randomWallet.address,
    mnemonic: randomWallet.mnemonic.phrase,
    balance: 10.0,
    goals: []
  };

  saveData();
  renderWalletUI();
  renderGoals();
  showStatus(
    "Кошелёк создан! Начислено 10 тестовых ETH. Нажмите на адрес сверху, чтобы посмотреть вашу Seed-фразу.",
    "success"
  );
}

function renderWalletUI() {
  const addr = walletData.address;
  connectBtn.textContent = `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  connectBtn.title = "Нажмите, чтобы показать Seed-фразу";
  networkBadge.textContent = "Встроенный кошелёк (Testnet)";
  balanceBadge.textContent = `${walletData.balance.toFixed(4)} ETH`;

  networkBadge.classList.remove("hidden");
  balanceBadge.classList.remove("hidden");
  createBtn.disabled = false;
  refreshBtn.disabled = false;
}

function renderGoals() {
  if (!walletData || walletData.goals.length === 0) {
    goalsList.innerHTML = `<p class="empty-state">У вас пока нет замороженных целей.</p>`;
    return;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  goalsList.innerHTML = "";

  [...walletData.goals].reverse().forEach((goal) => {
    const isUnlocked = nowSec >= goal.unlockTime;
    const dateStr = new Date(goal.unlockTime * 1000).toLocaleString("ru-RU");

    let statusTag = `<span class="tag tag-locked">Заморожено</span>`;
    let actionHtml = `<button class="btn btn-secondary btn-sm" disabled>Ждём дату</button>`;

    if (goal.withdrawn) {
      statusTag = `<span class="tag tag-done">Выведено</span>`;
      actionHtml = "";
    } else if (isUnlocked) {
      statusTag = `<span class="tag tag-ready">Доступно к выводу</span>`;
      actionHtml = `<button class="btn btn-success btn-sm" onclick="withdrawGoal(${goal.id})">Вывести</button>`;
    }

    const item = document.createElement("div");
    item.className = "goal-item";
    item.innerHTML = `
      <div class="goal-info">
        <h3>${escapeHtml(goal.name)}</h3>
        <div class="goal-amount">${goal.amount} ETH</div>
        <div class="goal-date">Разблокировка: ${dateStr}</div>
        ${statusTag}
      </div>
      <div>${actionHtml}</div>
    `;
    goalsList.appendChild(item);
  });
}

function openConfirmModal(goal) {
  pendingGoal = goal;
  confirmName.textContent = goal.name;
  confirmAmount.textContent = `${goal.amount} ETH`;
  confirmDate.textContent = new Date(goal.unlockTime * 1000).toLocaleString("ru-RU");
  confirmModal.classList.remove("hidden");
}

function closeConfirmModal() {
  pendingGoal = null;
  confirmModal.classList.add("hidden");
}

goalForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!walletData) return;

  const name = document.getElementById("goalName").value.trim();
  const amount = parseFloat(document.getElementById("goalAmount").value);
  const unlockInput = document.getElementById("unlockDate").value;
  const unlockTime = Math.floor(new Date(unlockInput).getTime() / 1000);

  if (amount <= 0 || amount > walletData.balance) {
    showStatus("Недостаточно ETH на балансе.", "error");
    return;
  }

  if (unlockTime <= Math.floor(Date.now() / 1000)) {
    showStatus("Дата разблокировки должна быть в будущем.", "error");
    return;
  }

  openConfirmModal({ name, amount, unlockTime });
});

confirmFreezeBtn.addEventListener("click", () => {
  if (!pendingGoal || !walletData) return;

  walletData.balance = Number((walletData.balance - pendingGoal.amount).toFixed(6));
  walletData.goals.push({
    id: walletData.goals.length,
    name: pendingGoal.name,
    amount: pendingGoal.amount,
    unlockTime: pendingGoal.unlockTime,
    withdrawn: false
  });

  const savedName = pendingGoal.name;
  const savedAmount = pendingGoal.amount;

  saveData();
  renderWalletUI();
  renderGoals();
  goalForm.reset();
  closeConfirmModal();
  showStatus(`Заморожено ${savedAmount} ETH на цель «${savedName}»!`, "success");
});

cancelFreezeBtn.addEventListener("click", closeConfirmModal);

confirmModal.addEventListener("click", (e) => {
  if (e.target === confirmModal) closeConfirmModal();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !confirmModal.classList.contains("hidden")) {
    closeConfirmModal();
  }
});

window.withdrawGoal = function (goalId) {
  const goal = walletData.goals.find((g) => g.id === goalId);
  if (!goal || goal.withdrawn) return;

  if (Math.floor(Date.now() / 1000) < goal.unlockTime) {
    showStatus("Средства ещё заморожены!", "error");
    return;
  }

  goal.withdrawn = true;
  walletData.balance = Number((walletData.balance + goal.amount).toFixed(6));

  saveData();
  renderWalletUI();
  renderGoals();
  showStatus(`Выведено ${goal.amount} ETH обратно на ваш баланс!`, "success");
};

connectBtn.addEventListener("click", createOrOpenWallet);
refreshBtn.addEventListener("click", renderGoals);

loadData();
