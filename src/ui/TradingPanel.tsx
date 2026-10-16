import { useState } from 'react';
import type { Item } from '../game/inventory';
import { ITEMS, SHOP_INVENTORY } from '../game/inventory';
import type { PlayerInventory } from '../game/inventory';

interface Props {
  npcId: string | null;
  inventory: PlayerInventory;
  onClose: () => void;
  onBuy: (itemId: string) => void;
}

export function TradingPanel({ npcId, inventory, onClose, onBuy }: Props) {
  const [message, setMessage] = useState('');
  if (!npcId) return null;
  const shopItems = SHOP_INVENTORY[npcId] || [];
  return (
    <div className="dialogue" style={{ zIndex: 40 }}>
      <header>
        <h2>Trade with {npcId}</h2>
        <button className="close" onClick={onClose}>×</button>
      </header>
      <div className="log">
        <div className="msg system">
          Coins: {inventory.state.coins}
        </div>
        {shopItems.map((itemId) => {
          const item = ITEMS[itemId] as Item;
          return (
            <div key={itemId} className="msg npc" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong>{item.name}</strong> - {item.price} coins<br />
                <small>{item.description}</small>
              </div>
              <button
                onClick={() => {
                  if (inventory.buy(itemId)) {
                    setMessage(`Bought ${item.name}!`);
                    onBuy(itemId);
                  } else {
                    setMessage('Not enough coins');
                  }
                }}
                style={{ marginLeft: 8, padding: '6px 12px' }}
              >
                Buy
              </button>
            </div>
          );
        })}
        {message && <div className="msg system">{message}</div>}
      </div>
      <div className="status">Trade complete? Close when done.</div>
    </div>
  );
}
