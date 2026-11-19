import {translator} from '../i18n.js';

export const artText = translator({
  bright:['Радостное','Көтеріңкі','Joyful'],
  restless:['Напряжённое','Мазасыз','Restless'],
  sad:['Грустное','Мұңды','Sad'],
  angry:['Злое','Ашулы','Angry'],
  calm:['Спокойное','Сабырлы','Calm'],
  float:['Длинная экспозиция','Ұзақ экспозиция','Long exposure'],
  lift:['Плёночный отпечаток','Фотопленкадан басылған сурет','Film print'],
  pan:['Контактный лист','Контакт парағы','Contact sheet'],
  cut:['Ритмический монтаж','Ырғақты монтаж','Rhythmic montage'],
  chosen:['Ты выбрал настроение «{mood}».','«{mood}» көңіл күйін өзің таңдадың.','You chose the {mood} mood.'],
  inferred:['По словам записи выбрано настроение «{mood}».','Жазбадағы сөздерге қарай «{mood}» көңіл күйі таңдалды.','The words in your entry suggest a {mood} mood.'],
  technique:['Приём «{technique}» задаёт композицию и движение кадра.','«{technique}» тәсілі кадрдың құрылымы мен қозғалысын анықтайды.','The {technique} technique sets the framing and movement.'],
  color:['Оттенок обложки {color} перешёл на край отпечатка и поля. Точка кадрирования сохраняет выбранную деталь.','Мұқабаның {color} реңкі суреттің жиегі мен жақтауында қайталанады. Кадрда өзің таңдаған тұс көрінеді.','The {color} tone from the cover tints the print’s edge and border. The crop keeps your chosen detail in view.'],
  videoColor:['Кадр из видео стал обложкой открытки.','Бейне кадры ашықхаттың мұқабасы болды.','A frame from your video is the postcard cover.'],
  missingColor:['Палитра появится после выбора обложки.','Мұқабаны таңдағанда оның түстері осында көрінеді.','Choose a cover to see its palette.'],
  manualTempo:['Темп задан тобой','Қарқынды өзің таңдадың','You set the pace'],
  linkTempo:['В открытке сохранена ссылка на песню','Ашықхатта әнге сілтеме сақталған','The postcard includes a link to the song'],
  measuredTempo:['Темп музыки — {bpm} уд/мин','Музыканың қарқыны минутына {bpm} соққы','The track plays at {bpm} beats per minute'],
  energyTempo:['Ритм выбран по энергии дорожки','Ырғақ әуеннің екпініне сай таңдалды','The track’s energy sets the rhythm'],
  time:['На один кадр отведено {seconds} с.','Әр кадр {seconds} с көрсетіледі.','Each frame lasts {seconds} s.']
});
