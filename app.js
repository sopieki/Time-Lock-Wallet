// Вставьте сюда адрес вашего задеплоенного контракта из Remix IDE
const CONTRACT_ADDRESS = "0x0000000000000000000000000000000000000000";

const CONTRACT_ABI = [
  "function createGoal(string calldata _name, uint256 _unlockTime) external payable",
  "function withdraw(uint256 _goalId) external",
  "function getMyGoals() external view returns (tuple(uint256 id, string name, uint256 amount, uint256 unlockTime, bool withdrawn)[])"
];

let provider, signer, contract, userAddress;

const connectBtn = document.getElementById("connectBtn");
const createBtn = document.getElementById("createBtn");
const refreshBtn = document.getElementById("refreshBtn");
const networkBadge = document.getElementById("networkBadge");
const balanceBadge = document.getElementById("balanceBadge");
const statusBox = document.getElementById("statusBox");
const goalsList = document.getElementById("goalsList");
const goalForm = document.getElementById("goalForm");

function showStatus(message, type = "") {
  statusBox.textContent = message;
  statusBox.className = `status ${type}`;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

async function connectWallet() {
  if (!window.ethereum) {
    showStatus("MetaMask не найден. Установите расширение MetaMask для браузера.", "error");
    return;
  }

  try {
    provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    signer = await provider.getSigner();
    userAddress = await signer.getAddress();

    const network = await provider.getNetwork();
    const balance = await provider.getBalance(userAddress);

    connectBtn.textContent = `${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
    networkBadge.textContent = `Сеть: ${network.name}`;
    balanceBadge.textContent = `${Number(ethers.formatEther(balance)).toFixed(4)} ETH`;
    networkBadge.classList.remove("hidden");
    balanceBadge.classList.remove("hidden");

    createBtn.disabled = false;
    refreshBtn.disabled = false;

    if (CONTRACT_ADDRESS === "0x0000000000000000000000000000000000000000") {
      showStatus("Кошелёк подключён! Теперь задеплойте контракт и вставьте CONTRACT_ADDRESS в app.js.", "error");
      return;
    }

    contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
    showStatus("Кошелёк успешно подключён.", "success");
    await loadGoals();
  } catch (err) {
    showStatus(`Ошибка подключения: ${err.message}`, "error");
  }
}

async function loadGoals() {
  if (!contract) return;

  try {
    const goals = await contract.getMyGoals();
    if (goals.length === 0) {
      goalsList.innerHTML = `<p class="empty-state">У вас пока нет замороженных целей.</p>`;
      return;
    }

    const nowSec = Math.floor(Date.now() / 1000);
    goalsList.innerHTML = "";

    [...goals].reverse().forEach((goal) => {
      const unlockSec = Number(goal.unlockTime);
      const isUnlocked = nowSec >= unlockSec;
      const dateStr = new Date(unlockSec * 1000).toLocaleString("ru-RU");
      const ethAmount = ethers.formatEther(goal.amount);

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
          <div class="goal-amount">${ethAmount} ETH</div>
          <div class="goal-date">Разблокировка: ${dateStr}</div>
          ${statusTag}
        </div>
        <div>${actionHtml}</div>
      `;
      goalsList.appendChild(item);
    });
  } catch (err) {
    showStatus(`Не удалось загрузить цели: ${err.message}`, "error");
  }
}

goalForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!contract) {
    showStatus("Сначала укажите CONTRACT_ADDRESS в app.js и подключите MetaMask.", "error");
    return;
  }

  const name = document.getElementById("goalName").value.trim();
  const amount = document.getElementById("goalAmount").value;
  const unlockInput = document.getElementById("unlockDate").value;
  const unlockTime = Math.floor(new Date(unlockInput).getTime() / 1000);

  if (unlockTime <= Math.floor(Date.now() / 1000)) {
    showStatus("Дата разблокировки должна быть в будущем.", "error");
    return;
  }

  try {
    createBtn.disabled = true;
    showStatus("Подтвердите транзакцию в MetaMask...");

    const tx = await contract.createGoal(name, unlockTime, {
      value: ethers.parseEther(amount)
    });

    showStatus("Транзакция отправлена. Ожидаем подтверждения в блокчейне...");
    await tx.wait();

    showStatus("Средства успешно заморожены!", "success");
    goalForm.reset();
    await loadGoals();
  } catch (err) {
    showStatus(`Ошибка транзакции: ${err.reason || err.message}`, "error");
  } finally {
    createBtn.disabled = false;
  }
});

window.withdrawGoal = async function (goalId) {
  try {
    showStatus("Подтвердите вывод средств в MetaMask...");
    const tx = await contract.withdraw(goalId);
    showStatus("Выводим средства...");
    await tx.wait();

    showStatus("Средства успешно возвращены на ваш кошелёк!", "success");
    await loadGoals();
  } catch (err) {
    showStatus(`Ошибка вывода: ${err.reason || err.message}`, "error");
  }
};

connectBtn.addEventListener("click", connectWallet);
refreshBtn.addEventListener("click", loadGoals);
