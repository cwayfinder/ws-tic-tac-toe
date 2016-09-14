const gameModel = {
  playerId: null,
  gameId: null,
  side: null,
};


const simpleView = (function view() {
  const signs = {
    x: '&#x2718;',
    o: '&#x25EF;',
  };

  function showLobby() {
    document.querySelector('#lobby').hidden = false;
    document.querySelector('#game').hidden = true;
    document.querySelector('#new-game').disabled = false;
  }

  function showGame() {
    document.querySelector('#lobby').hidden = true;
    document.querySelector('#game').hidden = false;
    document.querySelector('#game-loading').hidden = false;
  }

  function renderField() {
    document.querySelector('#game-loading').hidden = true;

    const rowInnerHtml = '<td></td>'.repeat(10);
    const rowOuterHtml = `<tr>${rowInnerHtml}</tr>`;
    document.querySelector('#field').innerHTML = rowOuterHtml.repeat(10);
  }

  function retrieveTurn(index, side) {
    const rowIndex = Math.floor((index - 1) / 10);
    const cellIndex = (index - 1) % 10;

    const cell = document.querySelector('#field').rows[rowIndex].cells[cellIndex];
    cell.innerHTML = signs[side];
  }

  function showError(message) {
    alert(message);
  }

  function showWinner(message) {
    alert(message);
    showLobby();
  }

  function addGame(gameId) {
    const li = `<li data-game-id="${gameId}">${gameId}</li>`;
    document.querySelector('#game-list').insertAdjacentHTML('beforeend', li);
  }

  function removeGame(gameId) {
    const li = document.querySelector(`#game-list [data-game-id=${gameId}]`);
    li.remove();
  }

  function disableNewButton() {
    document.querySelector('#new-game').disabled = true;
  }

  function enableNewButton() {
    document.querySelector('#new-game').disabled = false;
  }

  return {
    renderField,
    retrieveTurn,
    showError,
    showWinner,
    showLobby,
    showGame,
    addGame,
    removeGame,
    disableNewButton,
    enableNewButton,
  };
}());


const gameService = (function service(model) {
  const baseUrl = 'http://xo.t.javascript.ninja';

  function move(index) {
    const options = {
      method: 'POST',
      body: JSON.stringify({ move: index }),
      headers: {
        'Content-Type': 'application/json',
        Access: '*',
        'Game-ID': model.gameId,
        'Player-ID': model.playerId,
      },
    };

    return new Promise((resolve, reject) => {
      fetch(`${baseUrl}/move`, options)
        .then(response => {
          response.json().then(json => {
            if (response.ok) resolve(json);
            else reject(json.message || 'Unknown error');
          });
        });
    });
  }

  function surrender() {
    const options = {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Access: '*',
        'Game-ID': model.gameId,
        'Player-ID': model.playerId,
      },
    };

    return fetch(`${baseUrl}/surrender`, options)
      .then(response => response.json());
  }

  function gameReady() {
    const options = {
      method: 'POST',
      body: JSON.stringify({ player: model.playerId, game: model.gameId }),
      headers: {
        'Content-Type': 'application/json',
        Access: '*',
      },
    };

    return fetch(`${baseUrl}/gameReady`, options)
      .then(response => {
        if (response.ok) return response.json();

        if (response.status === 410) {
          throw new Error('Error when starting game: no answer from another player');
        } else {
          throw new Error('Unknown error when starting game');
        }
      });
  }

  function newGame() {
    return fetch(`${baseUrl}/newGame`, { method: 'POST' })
      .then(response => response.json());
  }

  function waitForOpponentTurn() {
    return new Promise(resolve => {
      const options = {
        headers: {
          Accept: '*',
          'Content-Type': 'application/json',
          'Game-ID': model.gameId,
          'Player-ID': model.playerId,
          mode: 'cors',
          cache: 'no-cache',
        },
        method: 'GET',
      };

      (function poll() {
        fetch(`${baseUrl}/move`, options)
          .then(response => resolve(response.json()))
          .catch(err => {
            window.console.error(err);
            poll();
          });
      }());
    });
  }

  return {
    move,
    surrender,
    gameReady,
    newGame,
    waitForOpponentTurn,
  };
}(gameModel));


const controller = (function controller(model, view, service) {
  const socket = new WebSocket('ws://xo.t.javascript.ninja/games');

  function waitForOpponentTurn() {
    service
      .waitForOpponentTurn()
      .then(json => {
        const opposite = model.side === 'x' ? 'o' : 'x';

        view.retrieveTurn(json.move, opposite);

        if (json.win) view.showWinner(json.win);
      });
  }

  function startGame(id) {
    view.showGame();

    model.playerId = id;

    service
      .gameReady()
      .then(json => {
        model.side = json.side;

        view.renderField();

        if (model.side === 'o') waitForOpponentTurn();
      })
      .catch(view.showError);
  }

  function bindDomEvents() {
    const buttonEl = document.querySelector('#new-game');
    buttonEl.addEventListener('click', () => {
      view.disableNewButton();

      service
        .newGame()
        .then(json => {
          model.gameId = json.yourId;
          socket.send(`{"register": "${json.yourId}" }`);
        });
    });


    document.querySelector('#game-list').addEventListener('click', event => {
      model.gameId = event.target.dataset.gameId;
      if (model.gameId) {
        socket.send(`{"register": "${model.gameId}" }`);
      }
    });

    document.querySelector('#surrender').addEventListener('click', () => {
      service
        .surrender()
        .then(view.showLobby);
    });

    document.querySelector('#field').addEventListener('click', event => {
      const target = event.target;
      if (target.tagName === 'TD') {
        const index = target.parentNode.rowIndex * 10 + target.cellIndex + 1;

        service
          .move(index)
          .then(json => {
            view.retrieveTurn(index, model.side);

            if (json.win) view.showWinner(json.win);
            else waitForOpponentTurn();
          })
          .catch(view.showError);
      }
    });
  }

  function bindWsEvents() {
    socket.onopen = () => window.console.log('WS: Connection established');

    socket.onclose = event => {
      if (event.wasClean) {
        window.console.log('WS: Connection closed clearly');
      } else {
        window.console.log('WS: Connection terminated'); // например, "убит" процесс сервера
      }
      window.console.log(`WS: Code: ${event.code}, reason: ${event.reason}`);
    };

    socket.onmessage = event => {
      window.console.log('WS: Received data', event.data);

      const data = JSON.parse(event.data);

      if (data.action === 'add') {
        view.addGame(data.id);
      } else if (data.action === 'remove') {
        view.removeGame(data.id);
      } else if (data.action === 'startGame') {
        startGame(data.id);
      }
    };

    socket.onerror = error => {
      window.console.log(`WS: Error ${error.message}`);

      view.enableNewButton();
    };
  }

  function init() {
    bindDomEvents();
    bindWsEvents();
  }

  return {
    init,
  };
}(gameModel, simpleView, gameService));


controller.init();
