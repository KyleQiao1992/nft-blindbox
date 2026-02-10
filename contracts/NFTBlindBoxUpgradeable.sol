// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title NFTBlindBoxUpgradeable
 * @dev 可升级的NFT盲盒合约，使用UUPS代理模式
 *
 * 设计模式说明：
 * 1. Library模式：使用RarityLibrary和MetadataLibrary处理纯逻辑
 * 2. 模块化设计：使用SaleManager模块处理销售逻辑
 * 3. 组合模式：通过VRFHandler处理VRF集成
 * 4. 存储库模式：使用BlindBoxStorage定义数据结构
 *
 * 这样可以实现：
 * - 代码复用和模块化
 * - 清晰的职责分离
 * - 便于测试和维护
 * - 支持合约升级
 */
contract NFTBlindBoxUpgradeable {}
