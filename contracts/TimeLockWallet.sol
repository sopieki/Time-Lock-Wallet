// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract TimeLockWallet {
    struct Goal {
        uint256 id;
        string name;
        uint256 amount;
        uint256 unlockTime;
        bool withdrawn;
    }

    mapping(address => Goal[]) private userGoals;

    event GoalCreated(
        address indexed user,
        uint256 indexed goalId,
        string name,
        uint256 amount,
        uint256 unlockTime
    );

    event GoalWithdrawn(
        address indexed user,
        uint256 indexed goalId,
        uint256 amount
    );

    function createGoal(string calldata _name, uint256 _unlockTime) external payable {
        require(msg.value > 0, "Deposit must be greater than 0");
        require(bytes(_name).length > 0, "Goal name is required");
        require(_unlockTime > block.timestamp, "Unlock time must be in the future");

        uint256 goalId = userGoals[msg.sender].length;

        userGoals[msg.sender].push(
            Goal({
                id: goalId,
                name: _name,
                amount: msg.value,
                unlockTime: _unlockTime,
                withdrawn: false
            })
        );

        emit GoalCreated(msg.sender, goalId, _name, msg.value, _unlockTime);
    }

    function withdraw(uint256 _goalId) external {
        require(_goalId < userGoals[msg.sender].length, "Goal does not exist");

        Goal storage goal = userGoals[msg.sender][_goalId];
        require(!goal.withdrawn, "Already withdrawn");
        require(block.timestamp >= goal.unlockTime, "Funds are still locked");

        uint256 amount = goal.amount;
        goal.withdrawn = true;

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "ETH transfer failed");

        emit GoalWithdrawn(msg.sender, _goalId, amount);
    }

    function getMyGoals() external view returns (Goal[] memory) {
        return userGoals[msg.sender];
    }
}
