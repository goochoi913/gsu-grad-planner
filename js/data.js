/* Course catalog — sections removed; meeting times are entered manually */

const COURSES = {
  required: [
    { id:'CSC3210',  subject:'CSC',  number:'3210', credits:4, title:'Computer Org & Programming',    type:'Lecture / Supervised Laboratory', prerequisites:'CSC 2310',             description:'Introduces computer organization, assembly-language programming, and hardware-software interaction. Topics include digital logic, data representation, memory hierarchy, instruction sets, and I/O systems.' },
    { id:'CSC3320',  subject:'CSC',  number:'3320', credits:3, title:'System-Level Programming',       type:'Lecture',                         prerequisites:'CSC 3210',            description:'Covers systems programming in C including processes, memory management, file I/O, signals, and inter-process communication on Unix/Linux.' },
    { id:'CSC3350',  subject:'CSC',  number:'3350', credits:4, title:'Software Development-CTW',       type:'Lecture',                         prerequisites:'CSC 3210',            description:'Project-based course emphasizing software design, version control, testing, and team collaboration. Writing component fulfills the CTW requirement.' },
    { id:'CSC4350',  subject:'CSC',  number:'4350', credits:4, title:'Software Engineering-CTW',       type:'Lecture',                         prerequisites:'CSC 3350',            description:'Advanced software engineering: requirements analysis, agile development, software architecture, and professional-level technical writing.' },
    { id:'CSC4320',  subject:'CSC',  number:'4320', credits:4, title:'Operating Systems',              type:'Lecture',                         prerequisites:'CSC 3320',            description:'Fundamentals of modern operating systems: process management, scheduling, memory allocation, file systems, concurrency, and virtualization.' },
    { id:'CSC4520',  subject:'CSC',  number:'4520', credits:4, title:'Design & Analysis: Algorithms',  type:'Lecture',                         prerequisites:'CSC 3320, MATH 2641', description:'Algorithm design paradigms including divide-and-conquer, dynamic programming, greedy algorithms, and graph algorithms. Complexity analysis and NP-completeness.' },
    { id:'MATH3020', subject:'MATH', number:'3020', credits:3, title:'Probability & Stats for CSC',    type:'Lecture',                         prerequisites:'MATH 2212 or 2215',   description:'Probability theory, random variables, distributions, statistical inference, and applications relevant to computer science.' },
    { id:'MATH2641', subject:'MATH', number:'2641', credits:3, title:'Linear Algebra I',               type:'Lecture',                         prerequisites:'MATH 2212 or 2215',   description:'Systems of linear equations, matrix algebra, determinants, vector spaces, linear transformations, eigenvalues and eigenvectors.' },
    { id:'PHYS2212', subject:'PHYS', number:'2212', credits:4, title:'Principles of Physics II',       type:'Lecture',                         prerequisites:'PHYS 2211',           description:'Electricity and magnetism, optics, and modern physics with experimental laboratory component.' },
    { id:'ECON2105', subject:'ECON', number:'2105', credits:3, title:'Principles of Macroeconomics', type:'Lecture',                           prerequisites:'None',                description:'An introduction to macroeconomics, focusing on the economy as a whole, including topics like GDP, inflation, unemployment, and fiscal/monetary policy.' },
  ],
  elective: [
    { id:'CSC3780',  subject:'CSC',  number:'3780', credits:4, title:'Fundamentals of Data Science',       type:'Lecture',                         prerequisites:'CSC 2310, MATH 3020',         description:'Data science workflows: wrangling, visualization, statistical modeling, and machine learning with Python (pandas, NumPy, scikit-learn).' },
    { id:'CSC4120',  subject:'CSC',  number:'4120', credits:4, title:'Intro to Robotics',                  type:'Lecture',                         prerequisites:'CSC 3210',                    description:'Robotic systems: kinematics, sensors, actuators, motion planning, and real-time control with hands-on hardware programming.' },
    { id:'CSC4220',  subject:'CSC',  number:'4220', credits:4, title:'Computer Networks',                  type:'Lecture',                         prerequisites:'CSC 3320',                    description:'Network architectures, protocols (TCP/IP, HTTP), routing, transport, and network security fundamentals.' },
    { id:'CSC4221',  subject:'CSC',  number:'4221', credits:4, title:'Mobile Comp & Wireless Net',         type:'Lecture',                         prerequisites:'CSC 4220',                    description:'Mobile computing architectures, wireless standards (WiFi, Bluetooth, 5G), and mobile app development.' },
    { id:'CSC4222',  subject:'CSC',  number:'4222', credits:4, title:'Fundamentals of Cybersecurity',      type:'Lecture',                         prerequisites:'CSC 3320',                    description:'Core cybersecurity: threat modeling, cryptography, network security, authentication, and vulnerability analysis.' },
    { id:'CSC4226',  subject:'CSC',  number:'4226', credits:4, title:'Secure Software Engineering',        type:'Lecture',                         prerequisites:'CSC 4222',                    description:'Security-focused development: secure coding, static/dynamic analysis, OWASP Top 10, and pen testing basics.' },
    { id:'CSC4228',  subject:'CSC',  number:'4228', credits:4, title:'Security in IoT',                    type:'Lecture',                         prerequisites:'CSC 4222',                    description:'IoT security: embedded systems vulnerabilities, protocol analysis, firmware analysis, and threat mitigation.' },
    { id:'CSC4260',  subject:'CSC',  number:'4260', credits:4, title:'Digital Image Processing',           type:'Lecture / Supervised Laboratory', prerequisites:'CSC 3210, MATH 2641',         description:'Image acquisition, enhancement, segmentation, and compression; intro to deep learning for vision.' },
    { id:'CSC4330',  subject:'CSC',  number:'4330', credits:4, title:'Programming Language Concepts',      type:'Lecture',                         prerequisites:'CSC 3320',                    description:'PL design: syntax, semantics, type systems, functional and logic paradigms, and language implementation.' },
    { id:'CSC4370',  subject:'CSC',  number:'4370', credits:4, title:'Web Programming',                    type:'Lecture',                         prerequisites:'CSC 3350',                    description:'Full-stack web development: HTML/CSS/JS, server-side frameworks, REST APIs, and modern front-end tooling.' },
    { id:'CSC4510',  subject:'CSC',  number:'4510', credits:4, title:'Automata',                           type:'Lecture',                         prerequisites:'CSC 3320, MATH 2641',         description:'Theory of computation: finite automata, regular languages, context-free grammars, Turing machines, decidability, and complexity.' },
    { id:'CSC4610',  subject:'CSC',  number:'4610', credits:3, title:'Numerical Analysis I',               type:'Lecture',                         prerequisites:'MATH 2641, CSC 2310',         description:'Numerical methods: root finding, interpolation, numerical integration and differentiation, solving linear systems.' },
    { id:'CSC4710',  subject:'CSC',  number:'4710', credits:4, title:'Database Systems',                   type:'Lecture',                         prerequisites:'CSC 3350',                    description:'Relational design, SQL, normalization, transaction management, query optimization, and intro to NoSQL.' },
    { id:'CSC4740',  subject:'CSC',  number:'4740', credits:4, title:'Data Mining',                        type:'Lecture',                         prerequisites:'CSC 3780 or MATH 3020',       description:'Discovering patterns in large datasets: classification, clustering, association rules, and dimensionality reduction.' },
    { id:'CSC4760',  subject:'CSC',  number:'4760', credits:4, title:'Big Data Programming',               type:'Lecture',                         prerequisites:'CSC 3780',                    description:'Large-scale data processing with Hadoop, Spark, and cloud platforms: distributed storage and pipelines.' },
    { id:'CSC4810',  subject:'CSC',  number:'4810', credits:4, title:'Artificial Intelligence',            type:'Lecture',                         prerequisites:'CSC 4520',                    description:'Core AI: search, constraint satisfaction, knowledge representation, planning, probabilistic reasoning, and intro to ML.' },
    { id:'CSC4814',  subject:'CSC',  number:'4814', credits:4, title:'Efficient AI',                       type:'Lecture',                         prerequisites:'CSC 4851 or CSC 4850',        description:'Building efficient AI systems: model compression, quantization, pruning, hardware-aware NAS, and edge deployment.' },
    { id:'CSC4820',  subject:'CSC',  number:'4820', credits:4, title:'Interactive Computer Graphics',      type:'Lecture / Supervised Laboratory', prerequisites:'CSC 3210, MATH 2641',         description:'3D graphics: rendering pipeline, rasterization, shaders, lighting, texture mapping using OpenGL/WebGL.' },
    { id:'CSC4821',  subject:'CSC',  number:'4821', credits:4, title:'Fundamentals of Game Design',        type:'Lecture',                         prerequisites:'CSC 4820',                    description:'Game design principles, mechanics, and development using a modern game engine.' },
    { id:'CSC4850',  subject:'CSC',  number:'4850', credits:4, title:'Machine Learning',                   type:'Lecture',                         prerequisites:'CSC 3780, MATH 3020, MATH 2641', description:'Supervised and unsupervised learning: regression, classification, neural networks, SVMs, and model evaluation.' },
    { id:'CSC4851',  subject:'CSC',  number:'4851', credits:4, title:'Intro Deep Learning',                type:'Lecture',                         prerequisites:'CSC 4850',                    description:'Deep neural networks: CNNs, RNNs, transformers, and attention — practical training with PyTorch/TensorFlow.' },
  ],
};

const SEMESTERS = [
  { id:'fall2026',   label:'Fall 2026',   shortLabel:"F'26",  maxCredits:18 },
  { id:'spring2027', label:'Spring 2027', shortLabel:"Sp'27", maxCredits:18 },
  { id:'summer2027', label:'Summer 2027', shortLabel:"Su'27", maxCredits:18 },
];

const DAY_ORDER  = ['M','T','W','Th','F'];
const DAY_LABELS = { M:'Mon', T:'Tue', W:'Wed', Th:'Thu', F:'Fri' };

const BLOCK_TYPES = ['Lecture','Lab','Recitation','Discussion','Other'];

const REQUIRED_CREDITS  = 32;
const ELECTIVE_CREDITS  = 12;
const TOTAL_MIN_CREDITS = 44;

/* Each course entry in state.schedule[semId]:
   { courseId: string, blocks: Block[] }

   Block:
   { id: string, type: string, days: string[], startTime: string,
     endTime: string, location: string, instructor: string, crn: string }
*/
