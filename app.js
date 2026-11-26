const CONTRACT_ADDRESS = "0x12dbA93987B42a49B284EfC074e18b48f817e954";

const SEPOLIA_CHAIN_ID_HEX = "0xaa36a7";
const SEPOLIA_CHAIN_ID = 11155111n;

const CONTRACT_ABI = [
  "function createGoal(string calldata _name, uint256 _unlockTime) external payable",
  "function withdraw(uint256 _goalId) external",
  "function getMyGoals() external view returns (tuple(uint256 id, string name, uint256 amount, uint256 unlockTime, bool withdrawn)[])",
  "event GoalCreated(address indexed user, uint256 indexed goalId, string name, uint256 amount, uint256 unlockTime)",
  "event GoalWithdrawn(address indexed user, uint256 indexed goalId, uint256 amount)"
];

let provider, signer, contract, userAddress;
let pendingGoal = null;
let currentGoals = [];
let currentBalanceWei = 0n;
let listenersAttached = false;
let countdownTimer = null;
let autoRefreshTimer = null;

const connectBtn = document.getElementById("connectBtn");
const createBtn = document.getElementById("createBtn");
const refreshBtn = document.getElementById("refreshBtn");
const networkBadge = document.getElementById("networkBadge");
const balanceBadge = document.getElementById("balanceBadge");
const lockedBadge = document.getElementById("lockedBadge");
const totalBadge = document.getElementById("totalBadge");
const statusBox = document.getElementById("statusBox");
const goalsList = document.getElementById("goalsList");
const txList = document.getElementById("txList");
const goalForm = document.getElementById("goalForm");

const confirmModal = document.getElementById("confirmModal");
const confirmName = document.getElementById("confirmName");
const confirmAmount = document.getElementById("confirmAmount");
const confirmDate = document.getElementById("confirmDate");
const cancelFreezeBtn = document.getElementById("cancelFreezeBtn");
const confirmFreezeBtn = document.getElementById("confirmFreezeBtn");

function showStatus(message, type = "", txHash = "") {
  statusBox.textContent = message;
  if (txHash && /^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    const space = document.createTextNode(" ");
    const link = document.createElement("a");
    link.href = `https://sepolia.etherscan.io/tx/${txHash}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Открыть в Etherscan ↗";
    link.style.color = "inherit";
    link.style.textDecoration = "underline";
    statusBox.appendChild(space);
    statusBox.appendChild(link);
  }
  statusBox.className = `status ${type}`;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function formatEth(wei) {
  return `${Number(ethers.formatEther(wei)).toFixed(4)} ETH`;
}

function formatCountdown(secondsLeft) {
  if (secondsLeft <= 0) return "Готово к выводу";
  const d = Math.floor(secondsLeft / 86400);
  const h = Math.floor((secondsLeft % 86400) / 3600);
  const m = Math.floor((secondsLeft % 3600) / 60);
  const s = secondsLeft % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return d > 0
    ? `Осталось: ${d}д ${pad(h)}ч ${pad(m)}м ${pad(s)}с`
    : `Осталось: ${pad(h)}:${pad(m)}:${pad(s)}`;
}

function getTxStorageKey() {
  return `timelock_txs_${CONTRACT_ADDRESS.toLowerCase()}_${userAddress.toLowerCase()}`;
}

function loadLocalTxs() {
  if (!userAddress) return [];
  try {
    return JSON.parse(localStorage.getItem(getTxStorageKey()) || "[]");
  } catch {
    return [];
  }
}

function saveLocalTx(txItem) {
  if (!userAddress) return;
  const list = loadLocalTxs();
  const idx = list.findIndex((t) => t.hash.toLowerCase() === txItem.hash.toLowerCase());
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...txItem };
  } else {
    list.unshift(txItem);
  }
  localStorage.setItem(getTxStorageKey(), JSON.stringify(list.slice(0, 50)));
}

async function updateBalances(goals = currentGoals) {
  if (!provider || !userAddress) return;
  currentBalanceWei = await provider.getBalance(userAddress);
  const lockedWei = goals.reduce(
    (sum, g) => (g.withdrawn ? sum : sum + BigInt(g.amount)),
    0n
  );
  const totalWei = currentBalanceWei + lockedWei;

  balanceBadge.textContent = formatEth(currentBalanceWei);
  lockedBadge.textContent = formatEth(lockedWei);
  totalBadge.textContent = formatEth(totalWei);
}

async function ensureSepoliaNetwork() {
  const currentChainId = await window.ethereum.request({ method: "eth_chainId" });
  if (currentChainId.toLowerCase() !== SEPOLIA_CHAIN_ID_HEX) {
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }]
      });
    } catch {
      throw new Error("Переключите сеть в MetaMask на тестовую сеть Sepolia.");
    }
  }
}

async function connectWallet() {
  if (!window.ethereum) {
    showStatus("MetaMask не найден. Установите расширение MetaMask для браузера.", "error");
    return;
  }

  try {
    await window.ethereum.request({ method: "eth_requestAccounts" });
    await ensureSepoliaNetwork();

    provider = new ethers.BrowserProvider(window.ethereum);
    signer = await provider.getSigner();
    userAddress = await signer.getAddress();

    const network = await provider.getNetwork();
    if (network.chainId !== SEPOLIA_CHAIN_ID) {
      showStatus("Пожалуйста, выберите тестовую сеть Sepolia в MetaMask.", "error");
      return;
    }

    connectBtn.textContent = `${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
    networkBadge.textContent = "Ethereum Sepolia • Live";
    await updateBalances([]);

    networkBadge.classList.remove("hidden");
    balanceBadge.classList.remove("hidden");

    if (!listenersAttached) {
      window.ethereum.on("accountsChanged", () => window.location.reload());
      window.ethereum.on("chainChanged", () => window.location.reload());
      listenersAttached = true;
    }

    contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
    createBtn.disabled = false;
    refreshBtn.disabled = false;

    showStatus("MetaMask подключён к сети Sepolia.", "success");
    await refreshDashboard();
    startLiveTimers();
  } catch (err) {
    showStatus(`Ошибка подключения: ${err.message}`, "error");
  }
}

function startLiveTimers() {
  if (countdownTimer) clearInterval(countdownTimer);
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);

  countdownTimer = setInterval(() => {
    const nowSec = Math.floor(Date.now() / 1000);
    let needRerender = false;

    document.querySelectorAll(".goal-countdown[data-unlock]").forEach((el) => {
      const unlockSec = Number(el.dataset.unlock);
      const diff = unlockSec - nowSec;
      if (diff <= 0) {
        needRerender = true;
      } else {
        el.textContent = formatCountdown(diff);
      }
    });

    if (needRerender) renderGoals();
  }, 1000);

  autoRefreshTimer = setInterval(() => {
    if (contract && !document.hidden) {
      updateBalances().catch(() => {});
    }
  }, 15000);
}

async function refreshDashboard() {
  if (!contract) return;
  try {
    const goals = await contract.getMyGoals();
    currentGoals = goals.map((g) => ({
      id: Number(g.id),
      name: g.name,
      amount: g.amount,
      unlockTime: Number(g.unlockTime),
      withdrawn: g.withdrawn
    }));

    await updateBalances(currentGoals);
    renderGoals();
    await loadTransactions();
  } catch (err) {
    showStatus(`Не удалось обновить данные: ${err.reason || err.message}`, "error");
  }
}

function renderGoals() {
  if (currentGoals.length === 0) {
    goalsList.innerHTML = `<p class="empty-state">У вас пока нет замороженных сейфов в блокчейне.</p>`;
    return;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  goalsList.innerHTML = "";

  [...currentGoals].reverse().forEach((goal) => {
    const isUnlocked = nowSec >= goal.unlockTime;
    const dateStr = new Date(goal.unlockTime * 1000).toLocaleString("ru-RU");
    const ethAmount = ethers.formatEther(goal.amount);

    let statusTag = `<span class="tag tag-locked">Заморожено</span>`;
    let countdownHtml = `<div class="goal-countdown" data-unlock="${goal.unlockTime}">${formatCountdown(goal.unlockTime - nowSec)}</div>`;
    let actionHtml = `<button class="btn btn-secondary btn-sm" disabled>Ждём дату</button>`;

    if (goal.withdrawn) {
      statusTag = `<span class="tag tag-done">Выведено</span>`;
      countdownHtml = "";
      actionHtml = "";
    } else if (isUnlocked) {
      statusTag = `<span class="tag tag-ready">Доступно к выводу</span>`;
      countdownHtml = "";
      actionHtml = `<button class="btn btn-success btn-sm" onclick="withdrawGoal(${goal.id})">Вывести</button>`;
    }

    const item = document.createElement("div");
    item.className = "goal-item";
    item.innerHTML = `
      <div class="goal-info">
        <h3>${escapeHtml(goal.name)}</h3>
        <div class="goal-amount">${ethAmount} ETH</div>
        <div class="goal-date">Разблокировка: ${dateStr}</div>
        ${countdownHtml}
        ${statusTag}
      </div>
      <div>${actionHtml}</div>
    `;
    goalsList.appendChild(item);
  });
}

async function loadTransactions() {
  if (!contract || !provider) return;

  const txMap = new Map();
  loadLocalTxs().forEach((tx) => txMap.set(tx.hash.toLowerCase(), tx));

  try {
    const latestBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latestBlock - 9000);

    const [createdLogs, withdrawnLogs] = await Promise.all([
      contract.queryFilter(contract.filters.GoalCreated(userAddress), fromBlock, latestBlock),
      contract.queryFilter(contract.filters.GoalWithdrawn(userAddress), fromBlock, latestBlock)
    ]);

    for (const log of createdLogs) {
      const hash = log.transactionHash;
      const existing = txMap.get(hash.toLowerCase());
      txMap.set(hash.toLowerCase(), {
        hash,
        type: "lock",
        name: log.args.name,
        amount: ethers.formatEther(log.args.amount),
        blockNumber: log.blockNumber,
        timestamp: existing?.timestamp || null
      });
    }

    for (const log of withdrawnLogs) {
      const hash = log.transactionHash;
      const goalId = Number(log.args.goalId);
      const matchedGoal = currentGoals.find((g) => g.id === goalId);
      const existing = txMap.get(hash.toLowerCase());
      txMap.set(hash.toLowerCase(), {
        hash,
        type: "withdraw",
        name: matchedGoal ? matchedGoal.name : `Сейф #${goalId + 1}`,
        amount: ethers.formatEther(log.args.amount),
        blockNumber: log.blockNumber,
        timestamp: existing?.timestamp || null
      });
    }
  } catch {
    // Показываем локально сохранённые транзакции при ограничении RPC
  }

  const allTxs = Array.from(txMap.values()).sort(
    (a, b) => (b.blockNumber || 0) - (a.blockNumber || 0) || (b.timestamp || 0) - (a.timestamp || 0)
  );

  renderTransactions(allTxs);
}

function renderTransactions(txs) {
  if (txs.length === 0) {
    txList.innerHTML = `<p class="empty-state">Транзакций пока нет. Создайте первый сейф, и запись сразу появится здесь.</p>`;
    return;
  }

  txList.innerHTML = "";
  txs.forEach((tx) => {
    const isWithdraw = tx.type === "withdraw";
    const safeHash = /^0x[a-fA-F0-9]{64}$/.test(tx.hash) ? tx.hash : "";
    const shortHash = safeHash ? `${safeHash.slice(0, 8)}...${safeHash.slice(-6)}` : "";
    const metaText = tx.timestamp
      ? new Date(tx.timestamp).toLocaleString("ru-RU")
      : tx.blockNumber
      ? `Блок #${tx.blockNumber}`
      : "Подтверждено в сети";

    const item = document.createElement("div");
    item.className = "tx-item";
    item.innerHTML = `
      <div class="tx-left">
        <div class="tx-icon ${isWithdraw ? "withdraw" : "lock"}">${isWithdraw ? "↑" : "↓"}</div>
        <div>
          <div class="tx-title">${isWithdraw ? "Вывод" : "Заморозка"}: ${escapeHtml(tx.name)}</div>
          <div class="tx-meta">${escapeHtml(metaText)}</div>
        </div>
      </div>
      <div class="tx-right">
        <div class="tx-amount ${isWithdraw ? "in" : "out"}">${isWithdraw ? "+" : "-"}${escapeHtml(String(tx.amount))} ETH</div>
        ${safeHash ? `<a class="tx-link" href="https://sepolia.etherscan.io/tx/${safeHash}" target="_blank" rel="noopener noreferrer">${shortHash} ↗</a>` : ""}
      </div>
    `;
    txList.appendChild(item);
  });
}

function openConfirmModal(goal) {
  pendingGoal = goal;
  confirmName.textContent = goal.name;
  confirmAmount.textContent = `${goal.amountStr} ETH`;
  confirmDate.textContent = new Date(goal.unlockTime * 1000).toLocaleString("ru-RU");
  confirmModal.classList.remove("hidden");
}

function closeConfirmModal() {
  pendingGoal = null;
  confirmModal.classList.add("hidden");
}

goalForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!contract) {
    showStatus("Сначала подключите MetaMask.", "error");
    return;
  }

  const name = document.getElementById("goalName").value.trim();
  const amountStr = document.getElementById("goalAmount").value.trim().replace(",", ".");
  const unlockInput = document.getElementById("unlockDate").value;
  const unlockTime = Math.floor(new Date(unlockInput).getTime() / 1000);

  if (!amountStr || Number(amountStr) <= 0) {
    showStatus("Введите корректную сумму в ETH.", "error");
    return;
  }

  let amountWei;
  try {
    amountWei = ethers.parseEther(amountStr);
  } catch {
    showStatus("Некорректный формат суммы.", "error");
    return;
  }

  if (amountWei >= currentBalanceWei) {
    showStatus("Недостаточно ETH на балансе (нужен небольшой запас на комиссию сети).", "error");
    return;
  }

  if (!unlockTime || unlockTime <= Math.floor(Date.now() / 1000)) {
    showStatus("Дата разблокировки должна быть в будущем.", "error");
    return;
  }

  openConfirmModal({ name, amountStr, unlockTime });
});

confirmFreezeBtn.addEventListener("click", async () => {
  if (!pendingGoal || !contract) return;

  const { name, amountStr, unlockTime } = pendingGoal;
  closeConfirmModal();

  try {
    createBtn.disabled = true;
    showStatus("Подтвердите транзакцию в окне MetaMask...");

    const tx = await contract.createGoal(name, unlockTime, {
      value: ethers.parseEther(amountStr)
    });

    showStatus("Транзакция отправлена в сеть Sepolia. Ждём подтверждения...", "", tx.hash);
    const receipt = await tx.wait();

    saveLocalTx({
      hash: tx.hash,
      type: "lock",
      name,
      amount: amountStr,
      blockNumber: receipt.blockNumber,
      timestamp: Date.now()
    });

    showStatus(`Заморожено ${amountStr} ETH на цель «${name}»!`, "success", tx.hash);
    goalForm.reset();
    await refreshDashboard();
  } catch (err) {
    showStatus(`Ошибка транзакции: ${err.shortMessage || err.reason || err.message}`, "error");
  } finally {
    createBtn.disabled = false;
  }
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

window.withdrawGoal = async function (goalId) {
  if (!contract) return;

  const goal = currentGoals.find((g) => g.id === goalId);

  try {
    showStatus("Подтвердите вывод средств в MetaMask...");
    const tx = await contract.withdraw(goalId);
    showStatus("Выводим средства из смарт-контракта...", "", tx.hash);
    const receipt = await tx.wait();

    saveLocalTx({
      hash: tx.hash,
      type: "withdraw",
      name: goal ? goal.name : `Сейф #${goalId + 1}`,
      amount: goal ? ethers.formatEther(goal.amount) : "",
      blockNumber: receipt.blockNumber,
      timestamp: Date.now()
    });

    showStatus("Средства успешно возвращены на ваш кошелёк!", "success", tx.hash);
    await refreshDashboard();
  } catch (err) {
    showStatus(`Ошибка вывода: ${err.shortMessage || err.reason || err.message}`, "error");
  }
};

connectBtn.addEventListener("click", connectWallet);
refreshBtn.addEventListener("click", refreshDashboard);
