import {translator} from '../i18n.js';

export const artText = translator({
  quiet:['Тихое','Тынық','Quiet'],
  tender:['Тёплое','Жылы','Tender'],
  bright:['Радостное','Көтеріңкі','Joyful'],
  restless:['Напряжённое','Мазасыз','Restless'],
  float:['Длинная экспозиция','Ұзақ экспозиция','Long exposure'],
  lift:['Плёночный отпечаток','Фотопленкадан басылған сурет','Film print'],
  pan:['Контактный лист','Контакт парағы','Contact sheet'],
  cut:['Ритмический монтаж','Ырғақты монтаж','Rhythmic montage'],
  chosen:['Ты выбрал настроение «{mood}».','«{mood}» көңіл күйін өзің таңдадың.','You chose the {mood} mood.'],
  inferred:['По словам записи выбрано настроение «{mood}».','Жазбадағы сөздерге қарай «{mood}» көңіл күйі таңдалды.','The words in your entry suggest a {mood} mood.'],
  technique:['Приём «{technique}» задаёт композицию и движение кадра.','«{technique}» тәсілі кадрдың құрылымы мен қозғалысын анықтайды.','The {technique} technique sets the framing and movement.'],
  color:['Оттенок обложки {color} перешёл на край отпечатка и поля. Точка кадрирования сохраняет выбранную деталь.','Мұқабаның {color} реңкі суреттің жиегі мен жақтауында қайталанады. Кадрда өзің таңдаған тұс көрінеді.','The {color} tone from the cover tints the print’s edge and border. The crop keeps your chosen detail in view.'],
  missingColor:['Палитра появится после выбора обложки.','Мұқабаны таңдағанда оның түстері осында көрінеді.','Choose a cover to see its palette.'],
  manualTempo:['Темп задан тобой','Қарқынды өзің таңдадың','You set the pace'],
  linkTempo:['Темп взят из выбранного характера песни','Қарқын әнге таңдаған сипатқа сай қойылды','The song character you chose sets the pace'],
  measuredTempo:['Темп музыки — {bpm} уд/мин','Музыканың қарқыны минутына {bpm} соққы','The track plays at {bpm} beats per minute'],
  energyTempo:['Ритм выбран по энергии дорожки','Ырғақ әуеннің екпініне сай таңдалды','The track’s energy sets the rhythm'],
  time:['На один кадр отведено {seconds} с.','Әр кадр {seconds} с көрсетіледі.','Each frame lasts {seconds} s.']
});
