// =====================================================================
// Совместный список покупок: Telegram Mini App + Supabase Realtime
// =====================================================================

// ---------- 1. Настройки: ЗАМЕНИТЕ ПЛЕЙСХОЛДЕРЫ НА СВОИ ЗНАЧЕНИЯ ----------

// Supabase → Project Settings → API → Project URL
const SUPABASE_URL = 'https://ВАШ_ПРОЕКТ.supabase.co';
// Supabase → Project Settings → API → ключ anon public (НЕ service_role!)
const SUPABASE_ANON_KEY = 'ВАШ_ANON_КЛЮЧ';
// Имя бота без символа @, например: my_shopping_bot
const BOT_USERNAME = 'ИМЯ_ВАШЕГО_БОТА';
// Короткое имя Mini App, которое вы задали в @BotFather через /newapp
const MINI_APP_SHORT_NAME = 'КОРОТКОЕ_ИМЯ_ПРИЛОЖЕНИЯ';

// Ключ в localStorage, под которым хранится идентификатор списка
const LIST_ID_STORAGE_KEY = 'shopping_list_id';

// ---------- 2. Инициализация Telegram WebApp ----------

const telegramWebApp = window.Telegram.WebApp;
telegramWebApp.ready();   // сообщаем Telegram, что приложение загружено
telegramWebApp.expand();  // разворачиваем приложение на весь экран

// Отключаем закрытие приложения свайпом вниз, чтобы случайно не вылететь
// (метод есть только в новых версиях Telegram, поэтому проверяем)
if (typeof telegramWebApp.disableVerticalSwipes === 'function') {
  telegramWebApp.disableVerticalSwipes();
}

// ---------- 3. Подключение к Supabase ----------

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------- 4. Определение идентификатора списка ----------

// Генерирует случайный идентификатор из латинских букв и цифр.
// Такие символы допустимы в параметре startapp (A-Z, a-z, 0-9, _ и -).
function generateListId() {
  const allowedCharacters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const randomValues = new Uint8Array(16);
  crypto.getRandomValues(randomValues);

  let generatedId = '';
  for (const randomValue of randomValues) {
    generatedId += allowedCharacters[randomValue % allowedCharacters.length];
  }
  return generatedId;
}

// Если приложение открыто по ссылке-приглашению, Telegram передаёт start_param.
// Иначе берём сохранённый идентификатор или создаём новый.
function resolveListId() {
  const startParameter = telegramWebApp.initDataUnsafe.start_param;

  if (startParameter) {
    // Запоминаем общий список, чтобы при обычном запуске приложение открывало его же
    localStorage.setItem(LIST_ID_STORAGE_KEY, startParameter);
    return startParameter;
  }

  const savedListId = localStorage.getItem(LIST_ID_STORAGE_KEY);
  if (savedListId) {
    return savedListId;
  }

  const newListId = generateListId();
  localStorage.setItem(LIST_ID_STORAGE_KEY, newListId);
  return newListId;
}

const currentListId = resolveListId();

// ---------- 5. Ссылки на элементы страницы ----------

const shoppingListElement = document.getElementById('shopping-list');
const emptyMessageElement = document.getElementById('empty-message');
const statusMessageElement = document.getElementById('status-message');
const remainingCounterElement = document.getElementById('remaining-counter');
const inviteButtonElement = document.getElementById('invite-button');
const addFormElement = document.getElementById('add-form');
const itemInputElement = document.getElementById('item-input');

// ---------- 6. Локальное состояние ----------

// Массив товаров текущего списка: { id, list_id, text, done, created_at }
let items = [];

// ---------- 7. Вспомогательные функции интерфейса ----------

// Лёгкая вибрация-отклик (если поддерживается устройством)
function triggerHapticFeedback() {
  if (telegramWebApp.HapticFeedback) {
    telegramWebApp.HapticFeedback.impactOccurred('light');
  }
}

// Показывает сообщение о состоянии или ошибке. Пустая строка скрывает сообщение.
function showStatusMessage(messageText, isError = false) {
  if (!messageText) {
    statusMessageElement.hidden = true;
    return;
  }
  statusMessageElement.textContent = messageText;
  statusMessageElement.classList.toggle('status-message--error', isError);
  statusMessageElement.hidden = false;
}

// Сортировка: сначала некупленные, потом купленные; внутри групп по времени добавления
function getSortedItems() {
  return [...items].sort((firstItem, secondItem) => {
    if (firstItem.done !== secondItem.done) {
      return firstItem.done ? 1 : -1;
    }
    return new Date(firstItem.created_at) - new Date(secondItem.created_at);
  });
}

// Создаёт элемент списка для одного товара.
// Текст вставляется через textContent, поэтому вредоносный HTML не выполнится.
function createItemElement(item) {
  const listItemElement = document.createElement('li');
  listItemElement.className = 'item' + (item.done ? ' item--done' : '');

  const labelElement = document.createElement('label');
  labelElement.className = 'item__label';

  const checkboxElement = document.createElement('input');
  checkboxElement.type = 'checkbox';
  checkboxElement.className = 'item__checkbox';
  checkboxElement.checked = item.done;
  checkboxElement.addEventListener('change', () => {
    toggleItemDone(item.id, checkboxElement.checked);
  });

  const boxElement = document.createElement('span');
  boxElement.className = 'item__box';

  const textElement = document.createElement('span');
  textElement.className = 'item__text';
  textElement.textContent = item.text;

  labelElement.append(checkboxElement, boxElement, textElement);

  const deleteButtonElement = document.createElement('button');
  deleteButtonElement.type = 'button';
  deleteButtonElement.className = 'item__delete';
  deleteButtonElement.setAttribute('aria-label', 'Удалить товар');
  deleteButtonElement.textContent = '×';
  deleteButtonElement.addEventListener('click', () => {
    deleteItem(item.id);
  });

  listItemElement.append(labelElement, deleteButtonElement);
  return listItemElement;
}

// Полностью перерисовывает список и счётчик
function renderItems() {
  const documentFragment = document.createDocumentFragment();
  for (const item of getSortedItems()) {
    documentFragment.appendChild(createItemElement(item));
  }
  shoppingListElement.replaceChildren(documentFragment);

  emptyMessageElement.hidden = items.length > 0;

  const remainingCount = items.filter((item) => !item.done).length;
  remainingCounterElement.textContent = items.length === 0
    ? 'Пока ничего нет'
    : `Осталось купить: ${remainingCount}`;
}

// ---------- 8. Операции с данными ----------

// Загрузка всех товаров текущего списка
async function loadItems() {
  const { data, error } = await supabaseClient
    .from('items')
    .select('*')
    .eq('list_id', currentListId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Ошибка загрузки списка:', error);
    showStatusMessage('Не удалось загрузить список. Проверьте интернет и ключи Supabase.', true);
    return;
  }

  showStatusMessage('');
  items = data;
  renderItems();
}

// Добавление нового товара (insert)
async function addItem(itemText) {
  const { data, error } = await supabaseClient
    .from('items')
    .insert({ list_id: currentListId, text: itemText })
    .select()
    .single();

  if (error) {
    console.error('Ошибка добавления товара:', error);
    showStatusMessage('Не удалось добавить товар. Попробуйте ещё раз.', true);
    return;
  }

  showStatusMessage('');
  // Realtime пришлёт это же событие, поэтому защищаемся от дубликата
  if (!items.some((existingItem) => existingItem.id === data.id)) {
    items.push(data);
    renderItems();
  }
}

// Переключение статуса «куплено» (update)
async function toggleItemDone(itemId, isDone) {
  triggerHapticFeedback();

  // Сразу обновляем экран, не дожидаясь ответа сервера
  const targetItem = items.find((existingItem) => existingItem.id === itemId);
  if (targetItem) {
    targetItem.done = isDone;
    renderItems();
  }

  const { error } = await supabaseClient
    .from('items')
    .update({ done: isDone })
    .eq('id', itemId);

  if (error) {
    console.error('Ошибка обновления товара:', error);
    showStatusMessage('Не удалось обновить товар.', true);
    loadItems(); // возвращаем актуальное состояние с сервера
  }
}

// Удаление товара (delete)
async function deleteItem(itemId) {
  triggerHapticFeedback();

  items = items.filter((existingItem) => existingItem.id !== itemId);
  renderItems();

  const { error } = await supabaseClient
    .from('items')
    .delete()
    .eq('id', itemId);

  if (error) {
    console.error('Ошибка удаления товара:', error);
    showStatusMessage('Не удалось удалить товар.', true);
    loadItems();
  }
}

// ---------- 9. Подписка на Supabase Realtime ----------

function subscribeToRealtimeChanges() {
  // Фильтр по списку: приходят только события с нашим list_id
  const listFilter = `list_id=eq.${currentListId}`;
  let isFirstSubscription = true;

  supabaseClient
    .channel(`shopping-list-${currentListId}`)

    // Кто-то добавил товар
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'items', filter: listFilter },
      (payload) => {
        const insertedItem = payload.new;
        if (!items.some((existingItem) => existingItem.id === insertedItem.id)) {
          items.push(insertedItem);
          renderItems();
        }
      }
    )

    // Кто-то отметил товар купленным или вернул обратно
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'items', filter: listFilter },
      (payload) => {
        const updatedItem = payload.new;
        items = items.map((existingItem) =>
          existingItem.id === updatedItem.id ? updatedItem : existingItem
        );
        renderItems();
      }
    )

    // Кто-то удалил товар.
    // Supabase не умеет фильтровать события DELETE, поэтому фильтр здесь не указан:
    // мы просто убираем товар по id, а чужие id в нашем массиве не встретятся.
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'items' },
      (payload) => {
        const deletedItemId = payload.old.id;
        if (items.some((existingItem) => existingItem.id === deletedItemId)) {
          items = items.filter((existingItem) => existingItem.id !== deletedItemId);
          renderItems();
        }
      }
    )

    .subscribe((subscriptionStatus) => {
      if (subscriptionStatus !== 'SUBSCRIBED') {
        return;
      }
      // При повторном подключении после обрыва связи перезагружаем список,
      // чтобы не пропустить изменения, сделанные в это время
      if (!isFirstSubscription) {
        loadItems();
      }
      isFirstSubscription = false;
    });
}

// ---------- 10. Приглашение партнёра ----------

function inviteParticipant() {
  // Ссылка запускает Mini App сразу с нашим списком
  const invitationLink =
    `https://t.me/${BOT_USERNAME}/${MINI_APP_SHORT_NAME}?startapp=${currentListId}`;

  // Ссылка шаринга открывает в Telegram выбор чата для отправки
  const shareLink =
    'https://t.me/share/url' +
    `?url=${encodeURIComponent(invitationLink)}` +
    `&text=${encodeURIComponent('Присоединяйся к нашему списку покупок')}`;

  if (typeof telegramWebApp.openTelegramLink === 'function') {
    telegramWebApp.openTelegramLink(shareLink);
  } else {
    // Запасной вариант для проверки в обычном браузере
    window.open(shareLink, '_blank');
  }
}

// ---------- 11. Обработчики событий ----------

inviteButtonElement.addEventListener('click', inviteParticipant);

addFormElement.addEventListener('submit', (submitEvent) => {
  submitEvent.preventDefault(); // не перезагружаем страницу

  const itemText = itemInputElement.value.trim();
  if (!itemText) {
    return;
  }

  itemInputElement.value = '';
  triggerHapticFeedback();
  addItem(itemText);
  itemInputElement.focus(); // клавиатура остаётся открытой для быстрого ввода
});

// Когда приложение снова становится видимым, обновляем список
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    loadItems();
  }
});

// ---------- 12. Запуск ----------

loadItems();
subscribeToRealtimeChanges();
